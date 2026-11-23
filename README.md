# Hana Dul – Học tiếng Hàn miễn phí

**Hana Dul** (하나 둘, “một, hai”): học tiếng Hàn từng bước.

Website miễn phí cho người Việt học tiếng Hàn từ sơ cấp: mỗi bài có bảng từ vựng, ghi chú ngữ pháp, bài trắc nghiệm bấm chọn có giải thích (từ vựng, ngữ pháp, nghe, đọc hiểu), luyện viết có câu mẫu và sổ câu sai để ôn lại. Không cần đăng ký: tiến độ lưu trên trình duyệt của người học; ai muốn học trên nhiều máy thì đăng nhập Google/email (không bắt buộc) để đồng bộ.

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
| `assets/account.js`, `assets/merge.js` | Tài khoản (Supabase) và cách gộp tiến độ giữa các máy |
| `supabase/` | SQL tạo bảng và hướng dẫn bật tài khoản |
| `tests/` | Test gộp tiến độ, test SQL, test giao diện tài khoản |

## Thêm một bài

1. Tạo `data/lessons/<id>.json` theo mẫu các bài có sẵn:
   - `vocab`: các nhóm từ, mỗi từ là `["từ tiếng Hàn", "nghĩa tiếng Việt"]` (phần tử thứ 3 tùy chọn là chữ đem đi đọc to). Câu hỏi từ vựng được sinh tự động, mỗi từ 1 câu, đáp án nhiễu lấy từ các từ khác trong bài.
   - `grammar`: mỗi mẫu có `pattern`, `title`, `note`, `examples` và `questions`. Trong mỗi câu hỏi, **đáp án đúng đặt ở vị trí đầu tiên** của `options`; web tự xáo thứ tự khi hiển thị.
   - `usage` (tùy chọn): câu "từ trong câu", cùng dạng câu hỏi như ngữ pháp (`q`, `options` với đáp án đúng đứng đầu, `explain`).
   - `listening` (tùy chọn): câu nghe, có `listen` (câu để máy đọc), `options`, `explain`, và `q` tùy chọn (mặc định "Nghe và chọn nghĩa đúng.").
   - `reading` (tùy chọn): `passage`, `passageVi` và `questions`.
   - `writing` (tùy chọn): `prompt`, `samples` (cặp `["câu mẫu", "nghĩa"]`) và `tips`.
   - `topik` (tùy chọn, dùng từ Trung cấp): câu dạng đề TOPIK II, mỗi câu có `type`, `q`, `options` (đáp án đúng đứng đầu), `explain`:
     - `blank` điền vào chỗ trống, `q` có `(    )`;
     - `similar` chọn nghĩa gần nhất, phần gạch chân bọc trong `__…__`;
     - `notice` đọc thông báo/quảng cáo, `order` sắp xếp câu (`passage` có đủ `(가)(나)(다)(라)`), `main` đọc đoạn văn: đều cần `passage` và `passageVi`;
     - `dialog` nghe hội thoại: `lines` (≥4 lượt `["người nói", "câu"]`, máy đọc đổi giọng theo người nói) và `linesVi`.
     Luyện nhanh lấy 1 câu mỗi dạng, Ôn đầy đủ lấy hết.
   - `fillWriting` (tùy chọn): bài viết điền ㉠/㉡ (dạng câu 51–52): `text`, `textVi`, `blanks` (`mark`, `answers` là các đáp án mẫu), `tips`. Người học tự so, không chấm; câu viết lưu cùng chỗ với Luyện viết.
2. Thêm bài vào `data/index.json`, đúng cấp độ (`sc1`, `sc2`…). Mỗi cấp là một khối riêng trên lộ trình trang chủ (`icon`, `subtitle`, `status` tùy chọn); cấp có `"prefix": true` thì tên bài hiện kèm tên cấp ("Sơ cấp 2 · Bài 1: …") ở tiêu đề tab và Sổ câu sai để không nhầm với bài cùng số của cấp khác.
3. Chạy `python3 tools/check_data.py` rồi `python3 tools/build_pages.py` (sinh trang tĩnh `bai/<id>/`, chỉ mục tra cứu, sitemap; CI báo lỗi nếu quên).
4. Kiểm thử đầu-cuối (Playwright): chạy `python3 -m http.server 8765` ở thư mục gốc rồi `node tools/e2e/run.js`. Script làm hết mọi bài (Ôn đầy đủ, Luyện nhanh), sổ câu sai, trang giới thiệu, điện thoại 375px, giao diện tối; in PASS/FAIL từng case.

## Trang tĩnh từng bài (cho Google) và ô tra cứu

- Trang học chạy bằng `#/…` nên Google không đọc được nội dung bài. `tools/build_pages.py` sinh từ `data/`: `bai/<id>/index.html` (từ vựng, ngữ pháp, ví dụ, bài đọc, câu mẫu; title/description/canonical/JSON-LD riêng; nút vào làm bài), `bai/index.html` (mọi bài), `data/search.json`, `sitemap.xml`, `robots.txt`. Không sửa tay các file này.
- Địa chỉ web chính thức nằm ở **một chỗ**: `data/site.json` (`url`). Đổi tên miền: sửa `url` rồi chạy lại script.
- `python3 tools/build_pages.py --check`: chỉ kiểm tra file đã khớp dữ liệu chưa (CI chạy trên mỗi PR).
- Ô "Tra từ, ngữ pháp" ([`assets/search.js`](assets/search.js)) có ở trang chủ, `/bai/` và mọi trang bài: gõ chữ Hàn (bỏ qua ngoặc, gạch: `으니까` khớp `-(으)니까`) hoặc tiếng Việt không cần dấu. Ở trang học, bấm kết quả mở bài và làm nổi bật thẻ từ / mẫu ngữ pháp; ở trang tĩnh, mở `bai/<id>/#t<n>` hoặc `#g<n>`.
- Test: `node tests/e2e_seo.js`.

## Trang giới thiệu, đăng ký và thống kê

- `gioi-thieu.html`: trang giới thiệu (lợi ích, lộ trình tới TOPIK, cảm nhận, đăng ký, hỏi đáp). Dùng link này khi chia sẻ lên mạng xã hội.
- `chinh-sach-bao-mat.html`: quyền riêng tư.
- `assets/config.js`: bật các dịch vụ ngoài. Mục nào để trống thì phần đó tự ẩn.
  - `gaId`: mã Google Analytics 4 (`G-…`). Ghi lượt xem từng màn (`/bai/sc1-03`, `/bai/sc1-03/lam-bai`…) và sự kiện `quiz_start`, `quiz_complete`, `review_complete`, `sign_up`, `feedback_sent`, `join_channel`, `cta_click`.
  - `form`: nơi nhận email đăng ký và cảm nhận (Formspree hoặc Google Form).
  - `zaloUrl`, `facebookUrl`: link nhóm/trang.
- `data/cam-nhan.json`: cảm nhận được đăng lên trang giới thiệu, dạng `[{"name": "Lan", "note": "sinh viên", "text": "…"}]`. Chỉ thêm cảm nhận thật mà người gửi đã đánh dấu đồng ý đăng.

## Tài khoản

Không bắt buộc. Bật bằng `supabaseUrl` + `supabaseKey` (khóa công khai) trong `assets/config.js`, làm theo [`supabase/README.md`](supabase/README.md). Để trống thì không có nút đăng nhập.

- Đăng nhập Google hoặc email (link + mã 6 số, không mật khẩu). Màn `#/tai-khoan`: đồng bộ, đăng xuất, xóa tài khoản.
- Đồng bộ toàn bộ `hanadul:v2` (bài, sao, XP, chuỗi ngày, Sổ câu sai, câu tự viết) vào bảng `progress`. Lần đầu đăng nhập, tiến độ khách trên máy được gộp vào tài khoản.
- Gộp ([`assets/merge.js`](assets/merge.js)): điểm/sao lấy cao nhất, ngày học hợp lại, XP cộng phần mỗi máy kiếm thêm, Sổ câu sai theo thay đổi mới nhất (có dấu "đã gỡ" để máy khác gỡ theo), câu viết lấy bản sửa sau cùng.
- Tên hiển thị (bảng `profiles`): khung "Tên hiển thị" ở `#/tai-khoan`, dùng cho chứng nhận và bảng xếp hạng; đọc bằng `HD.displayName()`.
- Đăng xuất xóa tiến độ khỏi máy đó (vẫn còn trên tài khoản). Thư viện `assets/vendor/supabase-2.118.0.js` (MIT) chỉ tải khi đã bật.

## Đề thi thử TOPIK II

- `#/thi-thu`: danh sách đề; `#/thi-thu/<id>`: giới thiệu; `/lam`: làm bài; `/ket-qua`: điểm và xem lại. Code ở [`assets/exam.js`](assets/exam.js).
- Miễn phí, không cần đăng nhập. Đồng hồ và chấm điểm chạy trên máy: bài đang làm lưu ở `localStorage` `hanadul:exam-run` (tải lại trang vẫn đếm tiếp, hết giờ tự nộp). Kết quả lưu vào tiến độ `exams` (điểm cao nhất, lượt gần nhất, đáp án đã chọn), đăng nhập thì đồng bộ như bài học. Mỗi câu đúng +2 XP.
- Dữ liệu: `data/exams/index.json` (danh sách đề) và `data/exams/<id>.json`: `minutes`, `sets` (mỗi bộ có `instruction`, `instructionVi`, tùy chọn `passage` + `passageVi`, `sentence` cho câu chèn ㉠–㉣, và `questions`: `n`, `q`, `options` 4 lựa chọn **giữ nguyên thứ tự**, `answer` là vị trí đúng 0–3, `explain`). Phần gạch chân bọc trong `__…__`. `tools/check_data.py` kiểm tra số câu liên tục, đáp án không dồn về một vị trí.
- Phần Viết (`"part": "viet"`, câu 51–54, 50 phút, 100 điểm): không chấm bằng AI. Câu 51–52 (`kind: "fill"`, `blanks` mỗi ô có danh sách `answers`): ô khớp một đáp án mẫu (bỏ qua dấu cách, dấu câu) tự được điểm, còn lại người học tự chấm Đúng / Gần đúng / Sai. Câu 53–54 (`kind: "chart"`/`"essay"`, `minChars`–`maxChars`, `data` + `dataVi`, `sample`, `rubric` 3 tiêu chí cộng đủ `points`, `tips`): người học so với bài mẫu rồi tự chấm từng tiêu chí Tốt / Khá / Yếu / Chưa đạt. Đếm chữ tính cả dấu cách, không tính xuống dòng. Bài viết và điểm tự chấm lưu trong `exams[id]` (`texts`, `self`, `gat`), +20 XP mỗi lần nộp có viết.

## Chứng nhận hoàn thành

- Trang Tài khoản có mục **Chứng nhận**: cấp độ đã đủ bài (`status` bắt đầu bằng "Đủ") và mọi bài đạt từ 2 sao thì bấm nhận (cần đăng nhập + tên hiển thị). Web đồng bộ tiến độ trước, rồi gọi `issue_certificate` trên Supabase (server kiểm lại số sao). Miễn phí, không phải chứng chỉ TOPIK.
- `chung-nhan.html?ma=HD-XXXX-XXXX`: trang xác minh công khai (không cần đăng nhập), in / lưu PDF được. Cài đặt: [`supabase/README.md`](supabase/README.md) mục 9.

## Bảng xếp hạng tuần

- `#/xep-hang` ([`assets/rank.js`](assets/rank.js)): ai cũng xem được; muốn có tên thì đăng nhập, đặt tên hiển thị, bấm Tham gia (mặc định không tham gia). XP tuần do server tính từ tiến độ đã đồng bộ. Cài đặt: [`supabase/README.md`](supabase/README.md) mục 10.

## Ôn hôm nay, huy hiệu, ảnh chia sẻ

- `assets/review.js` (`#/on-tap`): ôn ngắt quãng từ đã học. Làm bài trắc nghiệm thì từ của bài vào hàng ôn (từ đã hỏi theo kết quả, từ chưa hỏi chia tối đa 20 từ/ngày). Đúng thì hỏi lại sau 1, 3, 7, 14, 30, 60, 120 ngày; sai thì ngày mai. Mỗi lượt tối đa 20 từ. Bài bảng chữ (`vocabDirection: "ko"`) không đưa vào. Lưu ở `hanadul:v2` → `srs`, `srsLog`.
- `assets/badges.js` (`#/huy-hieu`): 18 huy hiệu tính từ tiến độ (chuỗi ngày dài nhất, từ đã học, bài, ôn, thi thử, XP); đạt rồi giữ luôn, lưu ở `badges` (id → thời điểm). Thêm huy hiệu: thêm vào `LIST`, không đổi id cũ.
- `assets/share.js`: ảnh 1080×1080 vẽ bằng canvas trên máy người học (kết quả bài, Ôn hôm nay, đề thi thử, huy hiệu, trang chứng nhận). Điện thoại có Web Share thì chia sẻ thẳng sang Facebook/Zalo; máy tính tải ảnh về.
- Cả ba đồng bộ theo tài khoản qua `assets/merge.js`; không cần đổi SQL.

## Kiểm thử

```bash
node tests/merge.test.js                       # gộp tiến độ
psql -d <db trống> -f tests/schema_test.sql    # SQL + phân quyền (giả lập auth của Supabase)
python3 -m http.server 8765 & SHOTS=/tmp node tests/e2e_account.js   # giao diện tài khoản (cần playwright)
node tests/e2e_regression.js                   # hồi quy phần học, làm bài, sổ câu sai
node tests/e2e_contact.js                      # GA4 + form đăng ký/cảm nhận
node tests/e2e_exam.js                         # đề thi thử (đồng hồ giả lập, không phải chờ 70 phút)
node tests/e2e_review.js                       # Ôn hôm nay, huy hiệu, ảnh chia sẻ
```

Các test Playwright giả lập Google Analytics và Formspree (`tests/stub_third_party.js`), nên không gửi số liệu hay email thật.

## Nội dung

Câu hỏi, ví dụ và giải thích đều tự soạn. Lộ trình chủ đề, từ vựng và ngữ pháp theo trình tự phổ biến của giáo trình sơ cấp. Góp ý hoặc báo lỗi qua mục Issues.

## Deploy

Web được GitHub Pages đăng trực tiếp từ nhánh `main` (Settings → Pages → Source: Deploy from a branch → `main` / `(root)`), mỗi lần merge là web tự cập nhật. Workflow `.github/workflows/check.yml` chạy `tools/check_data.py` trên mỗi PR.
