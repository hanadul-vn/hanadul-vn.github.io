# Bật tài khoản cho Hana Dul (Supabase)

Làm 1 lần, khoảng 20 phút. Khi chưa làm, web vẫn chạy như cũ (không có nút đăng nhập, tiến độ lưu trên máy).

> **Quy tắc khóa:** chỉ khóa **công khai** (Publishable key `sb_publishable_…` hoặc `anon`) được nằm trong `assets/config.js`.
> Secret key / `service_role` key và Client Secret của Google **không bao giờ** đưa vào repo hay gửi qua chat. Web tự tắt tài khoản nếu thấy khóa bí mật.

## 1. Tạo project

1. Vào <https://supabase.com> → đăng nhập → **New project**.
2. Tên: `hanadul`. Region: **Southeast Asia (Singapore)** (gần Việt Nam nhất; nếu chọn vùng khác, sửa câu "máy chủ đặt tại Singapore" trong `chinh-sach-bao-mat.html`).
3. Database password: đặt mật khẩu mạnh, tự giữ (web không cần).

## 2. Tạo bảng

**SQL Editor → New query** → dán toàn bộ [`schema.sql`](schema.sql) → **Run**. Chạy lại nhiều lần cũng không sao.

Bảng `progress` có bật Row Level Security: mỗi tài khoản chỉ đọc/sửa được dòng của mình; khách chưa đăng nhập không đọc được gì. Hàm `delete_my_account()` cho người dùng tự xóa tài khoản.

## 3. Địa chỉ được phép quay về sau khi đăng nhập

**Authentication → URL Configuration**

- Site URL: `https://hanadul.app`
- Redirect URLs: thêm `https://hanadul.app/**`, `https://hanadul-vn.github.io/**` (địa chỉ cũ, giữ trong lúc chuyển) và (để thử trên máy) `http://localhost:8000/**`

## 4. Đăng nhập bằng email (link + mã 6 số, không mật khẩu)

1. **Authentication → Sign In / Providers → Email**: bật (mặc định đã bật). Có thể tắt "Confirm email" không cần thiết vì đăng nhập bằng link/mã đã xác minh email.
2. **Authentication → Emails → Templates**: sửa cả **Magic Link** và **Confirm signup** cho có mã, ví dụ:

   ```html
   <h2>Đăng nhập Hana Dul</h2>
   <p>Mã đăng nhập của bạn: <b style="font-size:24px;letter-spacing:4px">{{ .Token }}</b></p>
   <p>Hoặc bấm nút: <a href="{{ .ConfirmationURL }}">Đăng nhập Hana Dul</a></p>
   <p>Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.</p>
   ```

   Tiêu đề gợi ý: `Mã đăng nhập Hana Dul`. Mã giúp người học mở email trên điện thoại nhưng học trên máy tính (link chỉ đăng nhập được trên đúng trình duyệt đã bấm gửi).
3. **Quan trọng:** email mặc định của Supabase chỉ gửi được vài email mỗi giờ, chỉ đủ để thử. Trước khi mở cho mọi người, vào **Authentication → Emails → SMTP Settings** gắn dịch vụ gửi mail riêng. Hana Dul đang dùng Brevo (`smtp-relay.brevo.com:587`, gửi từ `team@hanadul.app`).

## 5. Đăng nhập bằng Google

1. Vào <https://console.cloud.google.com> → tạo project `Hana Dul`.
2. **Google Auth Platform → Branding** (OAuth consent screen): tên ứng dụng `Hana Dul`, email hỗ trợ, logo (tùy chọn), link trang chủ `https://hanadul.app/`, link chính sách `https://hanadul.app/chinh-sach-bao-mat.html`, Authorized domains: `hanadul.app`. Audience: **External**, sau đó **Publish app** (để ai cũng đăng nhập được, không chỉ tài khoản thử).
3. **Clients → Create client** → loại **Web application**:
   - Authorized JavaScript origins: `https://hanadul.app` và `https://hanadul-vn.github.io`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback` (lấy đúng link ở Supabase → Authentication → Sign In / Providers → Google → "Callback URL").
4. Copy **Client ID** và **Client Secret** dán vào Supabase → **Authentication → Sign In / Providers → Google** → bật → Save. (Client Secret chỉ nằm trong Supabase, không đưa vào repo.)

## 6. Gắn vào web

**Project Settings → API Keys**: copy **Publishable key** (hoặc tab Legacy: `anon` key). **Project Settings → Data API**: copy **Project URL**.

Sửa `assets/config.js`:

```js
supabaseUrl: 'https://<project-ref>.supabase.co',
supabaseKey: 'sb_publishable_…'
```

Merge vào `main` là web có nút **Đăng nhập** (góc trên bên phải) và trang `#/tai-khoan`.

## 7. Thử nhanh sau khi bật

1. Mở web ở cửa sổ ẩn danh, làm 1 bài, bấm **Đăng nhập** → email → nhập mã → thấy avatar có chấm xanh.
2. Supabase → **Table Editor → progress**: có 1 dòng, cột `data` có `xp`, `lessons`.
3. Mở máy/trình duyệt khác, đăng nhập Google cùng email → thấy đúng XP và sao.

## 8. Tên hiển thị

Chạy lại toàn bộ [`schema.sql`](schema.sql) (an toàn, không mất dữ liệu cũ) để có bảng `profiles`: tên hiển thị người học tự đặt ở trang Tài khoản (2–40 ký tự, không có `< > { } \`), dùng cho chứng nhận và bảng xếp hạng. Mỗi tài khoản chỉ đọc/sửa tên của mình; xóa tài khoản thì tên mất theo.

## 9. Chứng nhận hoàn thành

Chạy lại toàn bộ [`schema.sql`](schema.sql) để có bảng `certificates` và 2 hàm:

- `issue_certificate(p_level, p_lessons)`: người học đã đăng nhập, đã đặt tên hiển thị, mọi bài của cấp độ đạt từ 2 sao **trong tiến độ trên server** thì được cấp mã `HD-XXXX-XXXX` (mỗi cấp độ 1 mã, cấp lại trả mã cũ). Tên chứng nhận do server đặt theo mã cấp độ (sc1 → "Hoàn thành Sơ cấp 1"), người dùng không tự sửa, không thêm/sửa thẳng vào bảng được.
- `verify_certificate(p_code)`: ai cũng gọi được (khóa công khai) để xác minh ở trang `chung-nhan.html?ma=…`; chỉ trả tên hiển thị, tên chứng nhận, số bài, điểm trung bình, ngày cấp.

Cấp độ chỉ có chứng nhận khi `status` trong `data/index.json` bắt đầu bằng "Đủ" (đã đủ bài). Xóa tài khoản thì chứng nhận mất theo.

## 10. Bảng xếp hạng tuần

Chạy lại toàn bộ [`schema.sql`](schema.sql): thêm cột `profiles.leaderboard` (mặc định tắt), bảng `weekly_xp` và các hàm `set_leaderboard(p_on)`, `leaderboard_week(p_ago)`.

- Server tự tính XP tuần (thứ Hai 0 giờ giờ Việt Nam) bằng trigger trên `progress`: chỉ với người đã bật, chỉ tính XP kiếm được từ lúc bật. Người dùng không ghi thẳng vào `weekly_xp`.
- `leaderboard_week(0)` tuần này, `(1)` tuần trước: ai cũng xem được, trả top 50 (tên hiển thị + XP tuần) và dòng của chính mình. Tắt tham gia là biến mất ngay.

## Ghi chú gói miễn phí

- Gói Free: 50.000 người dùng hoạt động/tháng, 500 MB dữ liệu, đủ dư cho giai đoạn đầu (mỗi người học chỉ vài chục KB).
- Project Free **tự tạm dừng nếu 7 ngày không có ai dùng**; vào dashboard bấm Restore là chạy lại. Khi web có người học đều thì không bị.
- Đồng bộ: mỗi tài khoản 1 dòng `progress.data` (cùng dạng localStorage `hanadul:v2`), cột `version` tránh 2 máy ghi đè nhau. Cách gộp: [`assets/merge.js`](../assets/merge.js).
