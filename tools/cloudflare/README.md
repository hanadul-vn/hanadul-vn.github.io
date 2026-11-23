# Chuyển Hana Dul sang hanadul.app

Cách làm: GitHub Pages vẫn phục vụ `hanadul-vn.github.io` như cũ (KHÔNG bật Custom domain trong GitHub, KHÔNG thêm file `CNAME`). Một Cloudflare Worker phục vụ `hanadul.app` bằng chính nội dung đó. Ở địa chỉ cũ, `assets/move.js` đưa người học sang `hanadul.app` kèm tiến độ đang lưu trong trình duyệt.

Không đụng tới bản ghi email (MX, SPF, DKIM của Brevo, Email Routing). Worker tự tạo bản ghi riêng cho `hanadul.app` và `www`.

Thứ tự nên làm: 1 → 2 → 3 → 4, rồi mới merge PR. (Nếu lỡ merge trước, `move.js` thấy `hanadul.app` chưa chạy thì để người học ở lại trang cũ, không mất gì.)

## 1. Tạo Worker (Cloudflare)

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker** (mẫu Hello World) → đặt tên `hanadul-web` → **Deploy**.
2. **Edit code** → xóa hết, dán toàn bộ [`worker.js`](worker.js) → **Deploy**.
3. Vào Worker `hanadul-web` → **Settings → Domains & Routes → Add → Custom domain** → `hanadul.app` → **Add domain**. Lặp lại với `www.hanadul.app`.
   - Nếu báo trùng bản ghi: vào **DNS → Records**, chỉ xóa bản ghi **A / AAAA / CNAME** có tên `hanadul.app` (`@`) hoặc `www`. Không xóa MX, TXT (SPF, DKIM `brevo…`, `_dmarc`).
4. Đợi 1–2 phút, mở <https://hanadul.app> phải thấy trang học. Mở <https://www.hanadul.app> phải tự chuyển về `hanadul.app`.

## 2. Supabase

**Authentication → URL Configuration**

- Site URL: `https://hanadul.app`
- Redirect URLs: **Add URL** `https://hanadul.app/**`. Giữ dòng `https://hanadul-vn.github.io/**`.

## 3. Google (đăng nhập Google)

<https://console.cloud.google.com> → project Hana Dul → **Google Auth Platform**

- **Clients** → client Web của Hana Dul → **Authorized JavaScript origins** → **Add URI** `https://hanadul.app` → Save. Giữ dòng cũ. Không sửa Authorized redirect URIs (vẫn là link `…supabase.co/auth/v1/callback`).
- **Branding**: Application home page `https://hanadul.app/`, Privacy policy `https://hanadul.app/chinh-sach-bao-mat.html`, **Authorized domains → Add domain** `hanadul.app` → Save. Nếu Google đòi xác minh tên miền: làm bước 5 trước.

## 4. Google Analytics (không bắt buộc)

Mã GA giữ nguyên, số liệu `hanadul.app` tự vào cùng property. Chỉ để tên cho đúng: **Admin → Data streams** → stream web → sửa Stream URL thành `https://hanadul.app`.

## 5. Google Search Console (nên làm, để Google tìm thấy địa chỉ mới)

<https://search.google.com/search-console> → **Add property → Domain** → `hanadul.app` → chọn xác minh qua Cloudflare (tự thêm bản ghi TXT, không ảnh hưởng email) → **Sitemaps** → gửi `https://hanadul.app/sitemap.xml`.

## Kiểm tra sau khi merge PR (vài phút sau khi GitHub Pages cập nhật)

- Mở `https://hanadul-vn.github.io/#/` trên trình duyệt đã học trước đó: tự sang `https://hanadul.app/#/`, điểm và sao còn nguyên, thanh địa chỉ không còn chuỗi dài `hd-move=`.
- Đăng nhập Google và email ở `hanadul.app` đều quay về đúng trang.
- Gửi thử email đăng nhập: vẫn tới, người gửi `team@hanadul.app`.

Người đã đăng nhập ở địa chỉ cũ cần đăng nhập lại một lần ở `hanadul.app` (phiên đăng nhập không mang theo, tiến độ vẫn còn trong tài khoản).

Giới hạn miễn phí của Worker: 100.000 lượt gọi/ngày (mỗi file trang tải là 1 lượt). Hiện dư rất nhiều; nếu sau này vượt, chuyển sang gói Workers Paid hoặc chuyển hẳn sang GitHub Pages Custom domain (khi đó địa chỉ cũ không chuyển tiến độ được nữa).
