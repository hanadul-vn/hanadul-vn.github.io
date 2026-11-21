# Học tiếng Hàn

Website miễn phí cho người Việt học tiếng Hàn từ sơ cấp: mỗi bài có bảng từ vựng, ghi chú ngữ pháp và bài trắc nghiệm bấm chọn có giải thích. Không cần đăng ký, tiến độ chỉ lưu trên trình duyệt của người học.

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

## Thêm một bài

1. Tạo `data/lessons/<id>.json` theo mẫu các bài có sẵn:
   - `vocab`: các nhóm từ, mỗi từ là `["từ tiếng Hàn", "nghĩa tiếng Việt"]` (phần tử thứ 3 tùy chọn là chữ đem đi đọc to). Câu hỏi từ vựng được sinh tự động, mỗi từ 1 câu, đáp án nhiễu lấy từ các từ khác trong bài.
   - `grammar`: mỗi mẫu có `pattern`, `title`, `note`, `examples` và `questions`. Trong mỗi câu hỏi, **đáp án đúng đặt ở vị trí đầu tiên** của `options`; web tự xáo thứ tự khi hiển thị.
2. Thêm bài vào `data/index.json`.
3. Chạy `python3 tools/check_data.py`.

## Nội dung

Câu hỏi, ví dụ và giải thích đều tự soạn. Lộ trình chủ đề, từ vựng và ngữ pháp theo trình tự phổ biến của giáo trình sơ cấp. Góp ý hoặc báo lỗi qua mục Issues.

## Deploy

Web được GitHub Pages đăng trực tiếp từ nhánh `main` (Settings → Pages → Source: Deploy from a branch → `main` / `(root)`), mỗi lần merge là web tự cập nhật. Workflow `.github/workflows/check.yml` chạy `tools/check_data.py` trên mỗi PR.
