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
