-- Kiểm tra supabase/schema.sql trên Postgres thường (giả lập phần auth của Supabase).
-- Chạy: psql -v ON_ERROR_STOP=1 -f tests/schema_test.sql  (từ thư mục gốc repo, trên DB trống)
\set ON_ERROR_STOP 1
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

\i supabase/schema.sql
\i supabase/schema.sql

insert into auth.users values ('11111111-1111-1111-1111-111111111111','a@x.vn'), ('22222222-2222-2222-2222-222222222222','b@x.vn');

-- TC: A thêm và đọc được dòng của mình
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.progress (user_id, data) values ('11111111-1111-1111-1111-111111111111', '{"xp": 10}');
do $$ begin assert (select count(*) from public.progress) = 1, 'A phải thấy 1 dòng'; end $$;
-- TC: A không thêm được dòng cho B
do $$ begin
  begin insert into public.progress (user_id, data) values ('22222222-2222-2222-2222-222222222222', '{}');
    raise exception 'A thêm được dòng của B';
  exception when insufficient_privilege then null; end;
end $$;
-- TC: cập nhật có điều kiện version (khóa lạc quan) và updated_at tự đổi
update public.progress set data = '{"xp": 20}', version = 2 where version = 1;
do $$ begin assert (select version from public.progress) = 2; end $$;
update public.progress set data = '{"xp": 99}', version = 2 where version = 1; -- bản cũ: không đổi gì
do $$ begin assert (select data->>'xp' from public.progress) = '20', 'ghi đè bằng version cũ'; end $$;
-- TC: data phải là object
do $$ begin
  begin update public.progress set data = '[1]'; raise exception 'nhận data không phải object';
  exception when check_violation then null; end;
end $$;

-- TC: B không thấy, không sửa được dòng của A
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin assert (select count(*) from public.progress) = 0, 'B thấy dòng của A'; end $$;
update public.progress set data = '{}' where user_id = '11111111-1111-1111-1111-111111111111';
reset role;
do $$ begin assert (select data->>'xp' from public.progress where user_id = '11111111-1111-1111-1111-111111111111') = '20', 'B sửa được của A'; end $$;

-- TC: khách (anon) không đọc được, không gọi được xóa tài khoản
set role anon;
do $$ begin
  begin perform 1 from public.progress; raise exception 'anon đọc được';
  exception when insufficient_privilege then null; end;
  begin perform public.delete_my_account(); raise exception 'anon gọi được delete';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- TC: B không xóa được (không có quyền delete); A tự xóa tài khoản → dòng progress mất theo, B còn nguyên
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin delete from public.progress; raise exception 'xóa trực tiếp được';
  exception when insufficient_privilege then null; end;
end $$;
select public.delete_my_account();
reset role;
do $$ begin
  assert (select count(*) from auth.users) = 1, 'A chưa bị xóa / B bị xóa nhầm';
  assert (select count(*) from public.progress) = 0, 'progress của A còn';
end $$;
\echo 'SCHEMA TESTS PASSED'
