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
-- ===== Tên hiển thị (B4) =====
insert into auth.users values ('33333333-3333-3333-3333-333333333333','c@x.vn');
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
-- TC P9: tự lưu và sửa tên của mình
insert into public.profiles (user_id, display_name) values ('33333333-3333-3333-3333-333333333333', 'Chi Nguyễn');
update public.profiles set display_name = '민 Hoàng';
do $$ begin assert (select display_name from public.profiles) = '민 Hoàng'; end $$;
-- TC P10: tên quá ngắn / quá dài / có ký tự lạ bị từ chối
do $$ begin
  begin update public.profiles set display_name = ' a '; raise exception 'tên 1 ký tự'; exception when check_violation then null; end;
  begin update public.profiles set display_name = repeat('a', 41); raise exception 'tên 41 ký tự'; exception when check_violation then null; end;
  begin update public.profiles set display_name = '<script>'; raise exception 'tên có <>'; exception when check_violation then null; end;
end $$;
-- TC P11: không tạo/sửa/thấy tên của người khác
do $$ begin
  begin insert into public.profiles (user_id, display_name) values ('22222222-2222-2222-2222-222222222222', 'Giả B');
    raise exception 'tạo tên cho B'; exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin assert (select count(*) from public.profiles) = 0, 'B thấy tên của C'; end $$;
update public.profiles set display_name = 'Bị sửa';
reset role;
do $$ begin assert (select display_name from public.profiles) = '민 Hoàng', 'B sửa được tên C'; end $$;
set role anon;
do $$ begin begin perform 1 from public.profiles; raise exception 'anon đọc profiles'; exception when insufficient_privilege then null; end; end $$;
reset role;
-- TC P12: xóa tài khoản C → tên mất theo
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select public.delete_my_account();
reset role;
do $$ begin
  assert (select count(*) from public.profiles) = 0, 'còn tên của C';
end $$;
-- ===== Chứng nhận (B4) =====
insert into auth.users values ('44444444-4444-4444-4444-444444444444','d@x.vn');
insert into public.progress (user_id, data) values ('44444444-4444-4444-4444-444444444444',
  (select jsonb_build_object('lessons', jsonb_object_agg('sc1-' || lpad(i::text, 2, '0'), jsonb_build_object('best', 80 + i, 'stars', case when i = 11 then 1 else 2 end)))
   from generate_series(1, 11) i));
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
-- TC C1: chưa đặt tên hiển thị → không cấp
do $$ begin
  begin perform public.issue_certificate('sc1', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i));
    raise exception 'cấp khi chưa có tên'; exception when others then assert sqlerrm like 'Cần đặt tên%', sqlerrm; end;
end $$;
insert into public.profiles (user_id, display_name) values ('44444444-4444-4444-4444-444444444444', 'Dũng Trần');
-- TC C2: có bài dưới 2 sao → không cấp, báo rõ bài nào
do $$ begin
  begin perform public.issue_certificate('sc1', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 11) i));
    raise exception 'cấp khi bài 11 mới 1 sao'; exception when others then assert sqlerrm like 'Chưa đạt: bài sc1-11 mới 1 sao%', sqlerrm; end;
end $$;
-- TC C3: đủ điều kiện → cấp mã HD-XXXX-XXXX, tên do server đặt, có số bài và điểm trung bình
create temp table cert1 as select * from public.issue_certificate('sc1', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i));
do $$ declare c record; begin
  select * into c from cert1;
  assert c.code ~ '^HD-[A-Z0-9]{4}-[A-Z0-9]{4}$', c.code;
  assert c.title = 'Hoàn thành Sơ cấp 1', c.title;
  assert c.display_name = 'Dũng Trần';
  assert c.detail = '{"lessons": 10, "avg": 86}'::jsonb, c.detail::text;
end $$;
-- TC C4: cấp lại → cùng mã; đổi tên rồi cấp lại → cùng mã, tên mới
update public.profiles set display_name = 'Trần Dũng';
do $$ declare c record; begin
  select * into c from public.issue_certificate('sc1', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i));
  assert c.code = (select code from cert1), 'mã đổi khi cấp lại';
  assert c.display_name = 'Trần Dũng';
  assert (select count(*) from public.certificates) = 1;
end $$;
-- TC C5: dữ liệu gửi lên không hợp lệ bị từ chối
do $$ begin
  begin perform public.issue_certificate('sc1', array['sc1-01','sc1-02']); raise exception 'ít bài'; exception when others then assert sqlerrm like 'Danh sách bài%', sqlerrm; end;
  begin perform public.issue_certificate('sc1', array(select 'sc1-01' from generate_series(1, 10))); raise exception 'trùng bài'; exception when others then assert sqlerrm like 'Danh sách bài%', sqlerrm; end;
  begin perform public.issue_certificate('sc2', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i)); raise exception 'bài cấp khác'; exception when others then assert sqlerrm like 'Bài sc1-01 không thuộc%', sqlerrm; end;
  begin perform public.issue_certificate('topik6', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i)); raise exception 'cấp lạ'; exception when others then assert sqlerrm like 'Cấp độ không hợp lệ%', sqlerrm; end;
end $$;
-- TC C6: không tự thêm/sửa chứng nhận trực tiếp
do $$ begin
  begin insert into public.certificates (code, user_id, kind, title, display_name) values ('HD-AAAA-AAAA', '44444444-4444-4444-4444-444444444444', 'level-sc2', 'Giả', 'X');
    raise exception 'tự thêm được'; exception when insufficient_privilege then null; end;
  begin update public.certificates set title = 'TOPIK 6'; raise exception 'tự sửa được'; exception when insufficient_privilege then null; end;
end $$;
-- TC C7: người khác không thấy; khách xác minh được theo mã (không phân biệt hoa thường, dấu cách), không đọc thẳng bảng
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.certificates) = 0, 'B thấy chứng nhận của D';
  begin perform public.issue_certificate('sc1', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i)); raise exception 'B không tên vẫn được cấp'; exception when others then assert sqlerrm like 'Cần đặt tên%', sqlerrm; end;
end $$;
reset role;
grant select on cert1 to anon;
set role anon;
do $$ declare c record; v text := (select code from cert1); begin
  select * into c from public.verify_certificate('  ' || lower(v) || ' ');
  assert c.display_name = 'Trần Dũng' and c.title = 'Hoàn thành Sơ cấp 1', 'xác minh sai';
  assert (select count(*) from public.verify_certificate('HD-0000-0000')) = 0;
  begin perform 1 from public.certificates; raise exception 'anon đọc bảng certificates'; exception when insufficient_privilege then null; end;
  begin perform public.issue_certificate('sc1', array['x']); raise exception 'anon cấp được'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- TC C8: tự xóa chứng nhận của mình; xóa tài khoản thì chứng nhận mất theo
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
delete from public.certificates;
do $$ begin assert (select count(*) from public.certificates) = 0, 'không xóa được'; end $$;
select code from public.issue_certificate('sc1', array(select 'sc1-' || lpad(i::text, 2, '0') from generate_series(1, 10) i)) \gset
select public.delete_my_account();
reset role;
do $$ begin assert (select count(*) from public.certificates) = 0, 'còn chứng nhận sau khi xóa tài khoản'; end $$;
\echo 'SCHEMA TESTS PASSED'
