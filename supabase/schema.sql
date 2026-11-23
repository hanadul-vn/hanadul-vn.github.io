-- Hana Dul: bảng lưu tiến độ học theo tài khoản.
-- Chạy 1 lần trong Supabase → SQL Editor → New query → dán toàn bộ file → Run. Chạy lại cũng không sao.

-- Mỗi tài khoản 1 dòng. data = tiến độ (bài đã làm, XP, chuỗi ngày, Sổ câu sai, bài viết), cùng dạng localStorage hanadul:v2.
-- version tăng 1 mỗi lần ghi, để 2 máy đồng bộ cùng lúc không đè mất dữ liệu của nhau.
create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint progress_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint progress_data_size check (pg_column_size(data) < 1000000)
);

create or replace function public.progress_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before update on public.progress
  for each row execute function public.progress_touch();

-- Chỉ chủ tài khoản đọc/ghi được dòng của mình. Khách (anon) không thấy gì.
alter table public.progress enable row level security;

drop policy if exists "progress: đọc của mình" on public.progress;
create policy "progress: đọc của mình" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "progress: thêm của mình" on public.progress;
create policy "progress: thêm của mình" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "progress: sửa của mình" on public.progress;
create policy "progress: sửa của mình" on public.progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.progress from anon;
grant select, insert, update on public.progress to authenticated;

-- Người dùng tự xóa tài khoản (nút "Xóa tài khoản" trên web). Xóa auth.users thì dòng progress tự xóa theo.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================
-- Tên hiển thị. Thêm 23/11/2026 (B4).
-- =====================================================================

-- Tên hiển thị (dùng cho chứng nhận và bảng xếp hạng). Mỗi tài khoản tự sửa dòng của mình.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  updated_at timestamptz not null default now(),
  constraint profiles_name_len check (char_length(btrim(display_name)) between 2 and 40),
  constraint profiles_name_chars check (display_name !~ '[<>{}\\]' and display_name !~ '[[:cntrl:]]')
);
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.progress_touch();
alter table public.profiles enable row level security;
drop policy if exists "profiles: đọc của mình" on public.profiles;
create policy "profiles: đọc của mình" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "profiles: thêm của mình" on public.profiles;
create policy "profiles: thêm của mình" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "profiles: sửa của mình" on public.profiles;
create policy "profiles: sửa của mình" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

-- =====================================================================
-- Chứng nhận hoàn thành cấp độ. Thêm 23/11/2026 (B4).
-- =====================================================================

-- Mỗi tài khoản nhận tối đa 1 chứng nhận cho mỗi cấp độ (kind = 'level-sc1'…). Mã HD-XXXX-XXXX để ai cũng xác minh được.
-- Không có quyền thêm/sửa trực tiếp: chỉ cấp qua hàm issue_certificate (kiểm tra tiến độ đã đồng bộ lên server).
create table if not exists public.certificates (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  display_name text not null,
  detail jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  constraint certificates_code_fmt check (code ~ '^HD-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  constraint certificates_kind_fmt check (kind ~ '^level-(sc|tc|cc)[0-9]{1,2}$'),
  constraint certificates_title_len check (char_length(title) between 3 and 80),
  constraint certificates_one_per_kind unique (user_id, kind)
);
alter table public.certificates enable row level security;
drop policy if exists "certificates: đọc của mình" on public.certificates;
create policy "certificates: đọc của mình" on public.certificates
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "certificates: xóa của mình" on public.certificates;
create policy "certificates: xóa của mình" on public.certificates
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.certificates from anon, authenticated;
grant select, delete on public.certificates to authenticated;

-- Cấp chứng nhận cấp độ p_level (sc1, sc2, tc3…) cho người đang đăng nhập.
-- p_lessons: mã các bài của cấp độ (web gửi theo data/index.json). Điều kiện: đã đặt tên hiển thị,
-- mỗi bài đều đạt từ 2 sao trở lên trong tiến độ trên server. Đã có thì trả lại chứng nhận cũ (cập nhật tên nếu đổi).
create or replace function public.issue_certificate(p_level text, p_lessons text[])
returns public.certificates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_data jsonb;
  v_kind text := 'level-' || coalesce(p_level, '');
  v_id text;
  v_stars int;
  v_sum int := 0;
  v_code text;
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_row public.certificates;
  v_title text;
  i int;
begin
  if v_uid is null then raise exception 'Cần đăng nhập' using errcode = '28000'; end if;
  if coalesce(p_level, '') !~ '^(sc|tc|cc)[0-9]{1,2}$' then raise exception 'Cấp độ không hợp lệ' using errcode = '22023'; end if;
  -- Tên chứng nhận do server đặt theo mã cấp độ (sc1 → Sơ cấp 1), người dùng không tự đặt được.
  v_title := 'Hoàn thành ' || case left(p_level, 2) when 'sc' then 'Sơ cấp ' when 'tc' then 'Trung cấp ' else 'Cao cấp ' end || substr(p_level, 3);
  select display_name into v_name from public.profiles where user_id = v_uid;
  if v_name is null then raise exception 'Cần đặt tên hiển thị trước' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_lessons, 1), 0) < 10
     or (select count(distinct x) from unnest(p_lessons) x) <> array_length(p_lessons, 1) then
    raise exception 'Danh sách bài không hợp lệ' using errcode = '22023';
  end if;
  select data into v_data from public.progress where user_id = v_uid;
  foreach v_id in array p_lessons loop
    if v_id !~ ('^' || p_level || '-[a-z0-9-]{1,20}$') then raise exception 'Bài % không thuộc cấp độ', v_id using errcode = '22023'; end if;
    v_stars := coalesce((v_data -> 'lessons' -> v_id ->> 'stars')::int, 0);
    if v_stars < 2 then raise exception 'Chưa đạt: bài % mới % sao (cần 2 sao)', v_id, v_stars using errcode = 'P0002'; end if;
    v_sum := v_sum + coalesce((v_data -> 'lessons' -> v_id ->> 'best')::int, 0);
  end loop;

  select * into v_row from public.certificates where user_id = v_uid and kind = v_kind;
  if found then
    if v_row.display_name <> v_name then
      update public.certificates set display_name = v_name where code = v_row.code returning * into v_row;
    end if;
    return v_row;
  end if;
  loop
    v_code := 'HD-';
    for i in 1..8 loop
      v_code := v_code || substr(v_abc, 1 + floor(random() * 32)::int, 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.certificates where code = v_code);
  end loop;
  insert into public.certificates (code, user_id, kind, title, display_name, detail)
  values (v_code, v_uid, v_kind, v_title, v_name,
          jsonb_build_object('lessons', array_length(p_lessons, 1), 'avg', round(v_sum::numeric / array_length(p_lessons, 1))))
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.issue_certificate(text, text[]) from public, anon;
grant execute on function public.issue_certificate(text, text[]) to authenticated;

-- Xác minh công khai theo mã (trang chung-nhan.html). Chỉ trả tên hiển thị, tên chứng nhận, ngày cấp; không có email hay mã tài khoản.
create or replace function public.verify_certificate(p_code text)
returns table (code text, kind text, title text, display_name text, detail jsonb, issued_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.kind, c.title, c.display_name, c.detail, c.issued_at
  from public.certificates c
  where c.code = upper(btrim(coalesce(p_code, '')));
$$;
revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;
