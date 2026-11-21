# Hana Dul – Học tiếng Hàn miễn phí

**Hana Dul** (하나 둘, “một, hai”): học tiếng Hàn từng bước.

Website miễn phí cho người Việt học tiếng Hàn từ sơ cấp: mỗi bài có bảng từ vựng, ghi chú ngữ pháp, bài trắc nghiệm bấm chọn có giải thích (từ vựng, ngữ pháp, nghe, đọc hiểu), luyện viết có câu mẫu và sổ câu sai để ôn lại. Không cần đăng ký, tiến độ chỉ lưu trên trình duyệt của người học.

## Chạy thử trên máy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `index.html`, `assets/` | Giao diện (HTML, CSS, JS thuần, không cần build) |
| `data/index.json` | Danh sách cấp độ và bài |
| `data/lessons/<id>.json` | Nội dung từng bài |
| `tools/check_data.py` | Kiểm tra dữ liệu bài, chạy trong CI trên mỗi PR |
| `tools/e2e/run.js` | Kiểm thử đầu-cuối bằng Playwright (chạy tay trước khi mở PR) |

## Thêm một bài

1. Tạo `data/lessons/<id>.json` theo mẫu các bài có sẵn:
   - `vocab`: các nhóm từ, mỗi từ là `["từ tiếng Hàn", "nghĩa tiếng Việt"]` (phần tử thứ 3 tùy chọn là chữ đem đi đọc to). Câu hỏi từ vựng được sinh tự động, mỗi từ 1 câu, đáp án nhiễu lấy từ các từ khác trong bài.
   - `grammar`: mỗi mẫu có `pattern`, `title`, `note`, `examples` và `questions`. Trong mỗi câu hỏi, **đáp án đúng đặt ở vị trí đầu tiên** của `options`; web tự xáo thứ tự khi hiển thị.
   - `usage` (tùy chọn): câu "từ trong câu", cùng dạng câu hỏi như ngữ pháp (`q`, `options` với đáp án đúng đứng đầu, `explain`).
   - `listening` (tùy chọn): câu nghe, có `listen` (câu để máy đọc), `options`, `explain`, và `q` tùy chọn (mặc định "Nghe và chọn nghĩa đúng.").
   - `reading` (tùy chọn): `passage`, `passageVi` và `questions`.
   - `writing` (tùy chọn): `prompt`, `samples` (cặp `["câu mẫu", "nghĩa"]`) và `tips`.
2. Thêm bài vào `data/index.json`.
3. Chạy `python3 tools/check_data.py`.
4. Kiểm thử đầu-cuối (Playwright): chạy `python3 -m http.server 8765` ở thư mục gốc rồi `node tools/e2e/run.js`. Script làm hết mọi bài (Ôn đầy đủ, Luyện nhanh), sổ câu sai, trang giới thiệu, điện thoại 375px, giao diện tối; in PASS/FAIL từng case.

## Trang giới thiệu, đăng ký và thống kê

- `gioi-thieu.html`: trang giới thiệu (lợi ích, lộ trình tới TOPIK, cảm nhận, đăng ký, hỏi đáp). Dùng link này khi chia sẻ lên mạng xã hội.
- `chinh-sach-bao-mat.html`: quyền riêng tư.
- `assets/config.js`: bật các dịch vụ ngoài. Mục nào để trống thì phần đó tự ẩn.
  - `gaId`: mã Google Analytics 4 (`G-…`). Ghi lượt xem từng màn (`/bai/sc1-03`, `/bai/sc1-03/lam-bai`…) và sự kiện `quiz_start`, `quiz_complete`, `review_complete`, `sign_up`, `feedback_sent`, `join_channel`, `cta_click`.
  - `form`: nơi nhận email đăng ký và cảm nhận (Formspree hoặc Google Form).
  - `zaloUrl`, `facebookUrl`: link nhóm/trang.
- `data/cam-nhan.json`: cảm nhận được đăng lên trang giới thiệu, dạng `[{"name": "Lan", "note": "sinh viên", "text": "…"}]`. Chỉ thêm cảm nhận thật mà người gửi đã đánh dấu đồng ý đăng.

## Nội dung

Câu hỏi, ví dụ và giải thích đều tự soạn. Lộ trình chủ đề, từ vựng và ngữ pháp theo trình tự phổ biến của giáo trình sơ cấp. Góp ý hoặc báo lỗi qua mục Issues.

## Deploy

Web được GitHub Pages đăng trực tiếp từ nhánh `main` (Settings → Pages → Source: Deploy from a branch → `main` / `(root)`), mỗi lần merge là web tự cập nhật. Workflow `.github/workflows/check.yml` chạy `tools/check_data.py` trên mỗi PR.
