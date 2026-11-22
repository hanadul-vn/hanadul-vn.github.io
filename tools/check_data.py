#!/usr/bin/env python3
"""Kiểm tra dữ liệu bài học: JSON hợp lệ, đủ trường, không trùng đáp án."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors = []


def err(msg):
    errors.append(msg)


index = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
ids = [l["id"] for lv in index["levels"] for l in lv["lessons"]]
if len(ids) != len(set(ids)):
    err("index.json: trùng id bài")

for lid in ids:
    path = ROOT / "data/lessons" / f"{lid}.json"
    if not path.exists():
        err(f"{lid}: thiếu file {path.name}")
        continue
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(f"{lid}: JSON lỗi: {e}")
        continue
    if d.get("id") != lid:
        err(f"{lid}: id trong file là {d.get('id')}")
    words = [w for g in d.get("vocab", []) for w in g["words"]]
    if len(words) < 4:
        err(f"{lid}: cần ít nhất 4 từ để tạo đáp án nhiễu")
    for w in words:
        if len(w) < 2 or not w[0].strip() or not w[1].strip():
            err(f"{lid}: từ thiếu nghĩa: {w}")
    def check_q(where, q, need_q=True):
        opts = q.get("options", [])
        label = q.get("q") or q.get("listen")
        if need_q and not q.get("q"):
            err(f"{lid} / {where}: thiếu câu hỏi")
        if len(opts) != 4:
            err(f"{lid} / {where}: câu cần đúng 4 đáp án: {label}")
        if len(set(opts)) != len(opts):
            err(f"{lid} / {where}: đáp án trùng nhau: {label}")
        if not q.get("explain"):
            err(f"{lid} / {where}: thiếu giải thích: {label}")

    for g in d.get("grammar", []):
        for q in g.get("questions", []):
            check_q(g["pattern"], q)
    for q in d.get("usage", []):
        check_q("Từ trong câu", q)
    for q in d.get("listening", []):
        if not q.get("listen"):
            err(f"{lid} / Nghe: thiếu câu cho máy đọc (listen)")
        check_q("Nghe", q, need_q=False)
    r = d.get("reading")
    if r:
        if not r.get("passage") or not r.get("passageVi"):
            err(f"{lid} / Đọc hiểu: thiếu đoạn văn hoặc bản dịch")
        if not r.get("questions"):
            err(f"{lid} / Đọc hiểu: chưa có câu hỏi")
        for q in r.get("questions", []):
            check_q("Đọc hiểu", q)
    TT = {"blank", "similar", "notice", "order", "main", "dialog"}
    for q in d.get("topik", []):
        t = q.get("type")
        if t not in TT:
            err(f"{lid} / TOPIK: dạng câu lạ: {t}")
            continue
        check_q("TOPIK " + t, q)
        if t in ("notice", "order", "main") and (not q.get("passage") or not q.get("passageVi")):
            err(f"{lid} / TOPIK {t}: thiếu đoạn văn hoặc bản dịch: {q.get('q')}")
        if t == "order":
            if not all(m in q.get("passage", "") for m in ("(가)", "(나)", "(다)", "(라)")):
                err(f"{lid} / TOPIK order: đoạn văn phải có đủ (가)(나)(다)(라)")
        if t == "similar" and q.get("q", "").count("__") != 2:
            err(f"{lid} / TOPIK similar: phải gạch chân đúng 1 đoạn bằng __…__: {q.get('q')}")
        if t == "blank" and "(" not in q.get("q", ""):
            err(f"{lid} / TOPIK blank: thiếu chỗ trống ( ): {q.get('q')}")
        if t == "dialog":
            lines = q.get("lines") or []
            if len(lines) < 4 or any(len(l) != 2 or not l[0] or not l[1] for l in lines):
                err(f"{lid} / TOPIK dialog: cần ≥4 lượt thoại [người nói, câu]")
            if not q.get("linesVi"):
                err(f"{lid} / TOPIK dialog: thiếu bản dịch hội thoại")
    for f in d.get("fillWriting", []):
        if not f.get("text") or not f.get("textVi") or not f.get("blanks"):
            err(f"{lid} / Viết điền: thiếu đoạn văn, bản dịch hoặc chỗ trống")
        for b in f.get("blanks", []):
            if b.get("mark") not in f.get("text", "") or not b.get("answers"):
                err(f"{lid} / Viết điền: chỗ {b.get('mark')} không có trong đoạn văn hoặc thiếu đáp án mẫu")
    w = d.get("writing")
    if w and (not w.get("prompt") or not w.get("samples")):
        err(f"{lid} / Luyện viết: thiếu đề hoặc câu mẫu")
    nq = sum(len(g.get('questions', [])) for g in d.get('grammar', []))
    print(f"{lid}: {len(words)} từ, {len(d.get('usage', []))} câu từ trong câu, {nq} câu ngữ pháp, "
          f"{len(d.get('listening', []))} câu nghe, {len(r['questions']) if r else 0} câu đọc, viết: {'có' if w else 'không'}"
          + (f", {len(d['topik'])} câu TOPIK, {len(d.get('fillWriting', []))} bài viết điền" if d.get('topik') else ""))

# Cảm nhận người học: chỉ đăng khi người gửi đã đồng ý.
fb_path = ROOT / "data/cam-nhan.json"
if fb_path.exists():
    try:
        fb = json.loads(fb_path.read_text(encoding="utf-8"))
        if not isinstance(fb, list):
            err("cam-nhan.json: phải là danh sách")
        else:
            for i, q in enumerate(fb):
                if not isinstance(q, dict) or not q.get("name") or not q.get("text"):
                    err(f"cam-nhan.json #{i + 1}: thiếu name hoặc text")
            print(f"cam-nhan.json: {len(fb)} cảm nhận")
    except json.JSONDecodeError as e:
        err(f"cam-nhan.json: JSON lỗi: {e}")

if errors:
    print("\nLỖI:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("OK")
