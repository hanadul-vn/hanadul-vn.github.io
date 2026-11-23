#!/usr/bin/env python3
"""Sinh trang tĩnh cho từng bài (để Google đọc được) và chỉ mục tra từ.

Trang học chính chạy bằng #/… nên Google không thấy nội dung bài. Script này đọc
data/index.json + data/lessons/<id>.json rồi ghi:

  bai/index.html          danh sách mọi bài, theo cấp
  bai/<id>/index.html     từ vựng, ngữ pháp, ví dụ, bài đọc, câu mẫu của bài; nút vào làm bài
  data/search.json        chỉ mục cho ô "Tra từ, ngữ pháp" (assets/search.js)
  sitemap.xml, robots.txt

Địa chỉ web (canonical, sitemap) lấy từ data/site.json.

  python3 tools/build_pages.py           ghi file
  python3 tools/build_pages.py --check   chỉ kiểm tra file đã khớp dữ liệu chưa (CI dùng)
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))["url"].rstrip("/")
INDEX = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))

# Trang tĩnh khác đưa vào sitemap: (đường dẫn, changefreq, priority)
STATIC_PAGES = [
    ("", "weekly", "1.0"),
    ("gioi-thieu.html", "monthly", "0.9"),
    ("bai/", "weekly", "0.8"),
    ("chinh-sach-bao-mat.html", "yearly", "0.3"),
]

HANGUL = "ᄀ-ᇿ㄰-㆏가-힯"
KO_RE = re.compile("([" + HANGUL + "][" + HANGUL + r"\s.,?!~()\-/]*)")


def esc(s):
    return html.escape(str(s), quote=True)


def ko(s):
    """Như ko() trong app.js: bọc chữ Hàn để dùng font tiếng Hàn."""
    return KO_RE.sub(r'<span class="ko">\1</span>', esc(s))


def plain(s):
    return str(s or "").replace("__", "")


def lesson_name(l):
    return l["title"] if l["no"] == "0" else f'Bài {l["no"]}: {l["title"]}'


def full_name(lv, l):
    return f'{lv["name"]} · {lesson_name(l)}'


def clip(s, n):
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= n:
        return s
    cut = s[: n - 1].rsplit(" ", 1)[0].rstrip(",;·:")
    return cut + "…"


def lessons():
    out = []
    for lv in INDEX["levels"]:
        for l in lv["lessons"]:
            d = json.loads((ROOT / "data/lessons" / f'{l["id"]}.json').read_text(encoding="utf-8"))
            out.append((lv, l, d))
    return out


def head(title, desc, canonical, depth, extra=""):
    up = "../" * depth
    # Đang ở địa chỉ cũ thì assets/move.js đưa người học sang tên miền mới kèm tiến độ (cần merge.js trước).
    # Chỉ nạp khi repo có move.js (nhánh chuyển tên miền).
    move = (f'  <script src="{up}assets/merge.js"></script>\n  <script src="{up}assets/move.js"></script>\n'
            if (ROOT / "assets/move.js").exists() else "")
    # Ảnh chia sẻ chung của web (chỉ khi repo có assets/og-image.jpg).
    og_img = ""
    if (ROOT / "assets/og-image.jpg").exists():
        img = SITE + "/assets/og-image.jpg"
        og_img = (f'  <meta property="og:image" content="{img}">\n'
                  '  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n'
                  '  <meta property="og:image:alt" content="Hana Dul – học tiếng Hàn miễn phí">\n'
                  '  <meta name="twitter:card" content="summary_large_image">\n')
    return f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="theme-color" content="#ff6b5b">
  <link rel="canonical" href="{esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Hana Dul">
  <meta property="og:url" content="{esc(canonical)}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
{og_img}  <link rel="icon" href="{up}assets/icon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400..900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="{up}assets/style.css">
  <link rel="stylesheet" href="{up}assets/bai.css">
{extra}{move}</head>
<body class="static-lesson" data-base="{up}">
  <!-- Trang sinh tự động bởi tools/build_pages.py từ data/. Đừng sửa tay. -->
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="{up}" aria-label="Hana Dul, vào trang học">
        <span class="brand-mark ko" aria-hidden="true">하</span>
        <span class="brand-text">Hana Dul<span class="brand-sub ko">하나 둘</span></span>
      </a>
      <a class="btn small" href="{up}#/">Vào trang học</a>
    </div>
  </header>
"""


def search_box(depth):
    return (
        '<div class="search" data-search>'
        '<label class="search-label" for="tra-cuu">🔎 Tra từ, ngữ pháp trong mọi bài</label>'
        '<input id="tra-cuu" class="search-input" type="search" autocomplete="off" spellcheck="false" '
        'placeholder="Ví dụ: 학교, trường học, 으니까" aria-describedby="tra-cuu-kq">'
        '<div id="tra-cuu-kq" class="search-results" aria-live="polite"></div></div>'
    )


def foot(depth):
    up = "../" * depth
    return f"""  <footer class="footer">
    <div class="container footer-inner">
      <span class="brand-mark small ko" aria-hidden="true">하</span>
      <div>
        <p><strong>Hana Dul</strong> · Học tiếng Hàn miễn phí cho người Việt. Nội dung tự soạn.</p>
        <p class="footer-links"><a href="{up}">Trang học</a> · <a href="{up}bai/">Tất cả bài</a> · <a href="{up}gioi-thieu.html">Giới thiệu</a> · <a href="{up}chinh-sach-bao-mat.html">Quyền riêng tư</a></p>
      </div>
    </div>
  </footer>
  <script src="{up}assets/config.js"></script>
  <script src="{up}assets/site.js"></script>
  <script src="{up}assets/search.js"></script>
</body>
</html>
"""


def json_ld(obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f'  <script type="application/ld+json">{s}</script>\n'


def lesson_page(lv, l, d, prev, nxt):
    lid = l["id"]
    url = f"{SITE}/bai/{lid}/"
    name = full_name(lv, l)
    words = [w for g in d["vocab"] for w in g["words"]]
    nwords = len({w[0] for w in words})
    grammar = d.get("grammar") or []
    hangeul = d.get("vocabDirection") == "ko"

    title = f'{name} ({d["ko"]}) – {"bảng chữ tiếng Hàn" if hangeul else "từ vựng, ngữ pháp tiếng Hàn"} | Hana Dul'
    if hangeul:
        desc = f'Học bảng chữ Hangeul: {nwords} nguyên âm, phụ âm kèm cách đọc gần đúng bằng tiếng Việt, cách ghép âm tiết và trắc nghiệm luyện nhận mặt chữ miễn phí.'
    else:
        sample = ", ".join(f"{w[0]} ({w[1].split(',')[0].split('(')[0].strip()})" for w in words[:3])
        pats = ", ".join(g["pattern"] for g in grammar[:3])
        desc = f'Tiếng Hàn {lv["name"]} bài {l["no"]} – {l["title"]}: {nwords} từ vựng như {sample}'
        if pats:
            desc += f"; ngữ pháp {pats}"
        desc += ". Có ví dụ, nghĩa tiếng Việt và trắc nghiệm miễn phí."
    desc = clip(desc, 200)

    ld = json_ld({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "LearningResource",
                "name": name,
                "alternateName": d["ko"],
                "description": desc,
                "url": url,
                "inLanguage": "vi",
                "teaches": "Tiếng Hàn: " + (d.get("goal") or l["title"]),
                "educationalLevel": lv["name"],
                "learningResourceType": "Bài học",
                "isAccessibleForFree": True,
                "provider": {"@type": "Organization", "name": "Hana Dul", "url": SITE + "/"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Hana Dul", "item": SITE + "/"},
                    {"@type": "ListItem", "position": 2, "name": "Tất cả bài", "item": SITE + "/bai/"},
                    {"@type": "ListItem", "position": 3, "name": name, "item": url},
                ],
            },
        ],
    })

    app = "../../#/bai/" + lid
    h = head(title, desc, url, 2, ld)
    h += '  <main class="container narrow">\n'
    h += (
        f'    <div class="lesson-hero" data-ko="{esc(d["ko"])}">'
        f'<nav class="crumbs" aria-label="Vị trí"><a href="../../">Trang chủ</a> / <a href="../#{esc(lv["id"])}">{esc(lv["name"])}</a></nav>'
        f'<h1><span class="emoji" aria-hidden="true">{esc(l.get("icon") or "📘")}</span>{esc(name)} <span class="ko" lang="ko">{esc(d["ko"])}</span></h1>'
    )
    if d.get("goal"):
        h += f'<p>{ko(d["goal"])}</p>'
    h += f'<div class="meta-chips"><span>📚 {nwords} {"chữ" if hangeul else "từ"}</span>'
    if grammar:
        h += f"<span>🧩 {len(grammar)} mẫu ngữ pháp</span>"
    h += "<span>✏️ Có trắc nghiệm</span></div></div>\n"
    h += (
        '    <div class="cta-bar top"><div><strong>Học bài này trên Hana Dul</strong><br>'
        '<span class="muted">Nghe phát âm, làm trắc nghiệm có giải thích, lưu sao và điểm ⭐</span></div>'
        f'<div class="cta-actions"><a class="btn" href="{app}/lam-bai" data-cta="bai-lam-bai">Làm bài →</a>'
        f'<a class="btn ghost" href="{app}" data-cta="bai-hoc">🔊 Nghe phát âm</a></div></div>\n'
    )
    h += "    " + search_box(2) + "\n"

    # Mục lục trong trang
    toc = ['<a href="#tu-vung">Từ vựng</a>']
    if grammar:
        toc.append('<a href="#ngu-phap">Ngữ pháp</a>')
    if d.get("reading"):
        toc.append('<a href="#bai-doc">Bài đọc</a>')
    if d.get("writing"):
        toc.append('<a href="#cau-mau">Câu mẫu</a>')
    h += '    <nav class="toc" aria-label="Trong bài này">' + " · ".join(toc) + "</nav>\n"

    # Từ vựng
    h += f'    <section id="tu-vung"><h2>{"Bảng chữ" if hangeul else "Từ vựng"}</h2>\n'
    wi = 0
    for g in d["vocab"]:
        h += f'      <h3 class="group-title"><span>{ko(g["group"])}</span></h3>\n'
        h += f'      <table class="vtable"><thead><tr><th scope="col">{"Chữ" if hangeul else "Tiếng Hàn"}</th><th scope="col">{"Đọc gần như" if hangeul else "Nghĩa"}</th></tr></thead><tbody>\n'
        for w in g["words"]:
            wi += 1
            h += f'        <tr id="t{wi}"><td class="ko" lang="ko">{esc(w[0])}</td><td>{ko(w[1])}</td></tr>\n'
        h += "      </tbody></table>\n"
    h += "    </section>\n"

    # Ngữ pháp
    if grammar:
        h += '    <section id="ngu-phap"><h2>Ngữ pháp</h2>\n'
        for gi, g in enumerate(grammar, 1):
            h += f'      <article class="gnote" id="g{gi}"><h3 class="gnote-head"><span class="gpat ko" lang="ko">{esc(g["pattern"])}</span>'
            if g.get("title"):
                h += f'<span class="gtitle">{ko(g["title"])}</span>'
            h += '</h3><div class="gnote-body">'
            for p in g.get("note") or []:
                h += f"<p>{ko(p)}</p>"
            if g.get("examples"):
                h += '<ul class="ex">'
                for e in g["examples"]:
                    h += f'<li><span class="txt"><span class="ex-ko" lang="ko">{esc(e[0])}</span><br><span class="ex-vi">{ko(e[1])}</span></span></li>'
                h += "</ul>"
            h += "</div></article>\n"
        h += "    </section>\n"

    # Bài đọc
    r = d.get("reading")
    if r and r.get("passage"):
        h += '    <section id="bai-doc"><h2>Bài đọc</h2>\n'
        h += f'      <div class="passage"><p class="ko" lang="ko">{esc(plain(r["passage"]))}</p>'
        if r.get("passageVi"):
            h += f'<details><summary>Xem nghĩa tiếng Việt</summary><p>{ko(plain(r["passageVi"]))}</p></details>'
        h += "</div>\n    </section>\n"

    # Câu mẫu luyện viết
    wr = d.get("writing")
    if wr and wr.get("samples"):
        h += '    <section id="cau-mau"><h2>Câu mẫu</h2>\n'
        if wr.get("prompt"):
            h += f'      <p class="muted">{ko(wr["prompt"])}</p>\n'
        h += '      <ul class="ex samples">'
        for s in wr["samples"]:
            h += f'<li><span class="txt"><span class="ex-ko" lang="ko">{esc(s[0])}</span><br><span class="ex-vi">{ko(s[1])}</span></span></li>'
        h += "</ul>\n    </section>\n"

    h += (
        '    <div class="cta-bar"><div><strong>Sẵn sàng chưa?</strong><br><span class="muted">Làm bài trắc nghiệm để nhớ lâu hơn, miễn phí, không cần đăng ký.</span></div>'
        f'<a class="btn" href="{app}/lam-bai" data-cta="bai-lam-bai-cuoi">Làm bài →</a></div>\n'
    )
    h += '    <nav class="pager" aria-label="Bài trước, bài sau">'
    h += (f'<a class="prev" href="../{esc(prev[1]["id"])}/" rel="prev"><span class="muted">← Bài trước</span><br>{esc(full_name(prev[0], prev[1]))}</a>' if prev else "<span></span>")
    h += (f'<a class="next" href="../{esc(nxt[1]["id"])}/" rel="next"><span class="muted">Bài sau →</span><br>{esc(full_name(nxt[0], nxt[1]))}</a>' if nxt else "<span></span>")
    h += "</nav>\n  </main>\n"
    return h + foot(2)


def list_page(all_):
    url = f"{SITE}/bai/"
    total = len(all_)
    title = "Tất cả bài học tiếng Hàn: sơ cấp, trung cấp | Hana Dul"
    desc = clip(
        f"{total} bài học tiếng Hàn miễn phí cho người Việt, từ bảng chữ Hangeul, sơ cấp tới trung cấp: "
        "từ vựng, ngữ pháp có ví dụ và trắc nghiệm có giải thích.", 200)
    items = []
    for i, (lv, l, d) in enumerate(all_, 1):
        items.append({"@type": "ListItem", "position": i, "url": f'{SITE}/bai/{l["id"]}/', "name": full_name(lv, l)})
    ld = json_ld({"@context": "https://schema.org", "@type": "ItemList", "name": "Bài học tiếng Hàn Hana Dul", "itemListElement": items})
    h = head(title, desc, url, 1, ld)
    h += '  <main class="container narrow">\n'
    h += '    <h1 class="page-title">Tất cả bài học</h1>\n'
    h += f'    <p class="muted">{total} bài, mỗi bài có từ vựng, ngữ pháp kèm ví dụ và trắc nghiệm có giải thích. Bấm vào bài để xem nội dung.</p>\n'
    h += "    " + search_box(1) + "\n"
    for lv in INDEX["levels"]:
        h += f'    <section class="lv" id="{esc(lv["id"])}"><h2>{esc(lv.get("icon") or "📘")} {esc(lv["name"])}</h2>'
        if lv.get("subtitle"):
            h += f'<p class="muted">{esc(lv["subtitle"])}</p>'
        h += '<ol class="lesson-list">'
        for l in lv["lessons"]:
            h += (
                f'<li><a href="{esc(l["id"])}/"><span class="ll-ic" aria-hidden="true">{esc(l.get("icon") or "📘")}</span>'
                f'<span><span class="ll-name">{esc(lesson_name(l))}</span> <span class="ko" lang="ko">{esc(l["ko"])}</span>'
                f'<br><span class="muted ll-sum">{ko(l.get("summary") or "")}</span></span></a></li>'
            )
        h += "</ol></section>\n"
    h += "  </main>\n"
    return h + foot(1)


def search_index(all_):
    """Chỉ mục gọn: l = bài [id, tên đầy đủ], w = từ [hàn, nghĩa, bài, số thứ tự từ], g = ngữ pháp [mẫu, nghĩa, bài, số thứ tự]."""
    out = {"l": [], "w": [], "g": []}
    for li, (lv, l, d) in enumerate(all_):
        out["l"].append([l["id"], full_name(lv, l)])
        wi = 0
        for g in d["vocab"]:
            for w in g["words"]:
                wi += 1
                out["w"].append([w[0], w[1], li, wi])
        for gi, g in enumerate(d.get("grammar") or [], 1):
            out["g"].append([g["pattern"], g.get("title") or "", li, gi])
    return json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"


def sitemap(all_):
    rows = [f"  <url><loc>{SITE}/{p}</loc><changefreq>{c}</changefreq><priority>{pr}</priority></url>" for p, c, pr in STATIC_PAGES]
    rows += [f'  <url><loc>{SITE}/bai/{l["id"]}/</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>' for lv, l, d in all_]
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n"


def robots():
    return f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n"


def build():
    all_ = lessons()
    files = {}
    for i, (lv, l, d) in enumerate(all_):
        prev = all_[i - 1][:2] if i > 0 else None
        nxt = all_[i + 1][:2] if i + 1 < len(all_) else None
        files[f'bai/{l["id"]}/index.html'] = lesson_page(lv, l, d, prev, nxt)
    files["bai/index.html"] = list_page(all_)
    files["data/search.json"] = search_index(all_)
    files["sitemap.xml"] = sitemap(all_)
    files["robots.txt"] = robots()
    return files


def main():
    check = "--check" in sys.argv
    files = build()
    # Trang của bài đã bị xóa khỏi index.json
    keep = {p.split("/")[1] for p in files if p.startswith("bai/") and p.count("/") == 2}
    stale_dirs = [p for p in (ROOT / "bai").glob("*/") if p.is_dir() and p.name not in keep] if (ROOT / "bai").exists() else []
    bad = []
    for rel, text in files.items():
        path = ROOT / rel
        cur = path.read_text(encoding="utf-8") if path.exists() else None
        if cur == text:
            continue
        bad.append(rel)
        if not check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    for p in stale_dirs:
        bad.append(f"bai/{p.name}/ (bài không còn trong index.json)")
        if not check:
            for f in p.iterdir():
                f.unlink()
            p.rmdir()
    if check:
        if bad:
            print("Trang tĩnh chưa khớp dữ liệu, chạy: python3 tools/build_pages.py")
            for b in bad:
                print("  -", b)
            sys.exit(1)
        print(f"OK: {len(files)} file trang tĩnh khớp dữ liệu.")
    else:
        print(f"Đã ghi {len(bad)} file thay đổi / {len(files)} file ({SITE}).")


if __name__ == "__main__":
    main()
