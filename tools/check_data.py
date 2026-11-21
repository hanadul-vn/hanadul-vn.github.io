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
    for g in d.get("grammar", []):
        for q in g.get("questions", []):
            opts = q.get("options", [])
            if len(opts) != 4:
                err(f"{lid} / {g['pattern']}: câu cần đúng 4 đáp án: {q.get('q')}")
            if len(set(opts)) != len(opts):
                err(f"{lid} / {g['pattern']}: đáp án trùng nhau: {q.get('q')}")
            if not q.get("explain"):
                err(f"{lid} / {g['pattern']}: thiếu giải thích: {q.get('q')}")
    print(f"{lid}: {len(words)} từ, {sum(len(g.get('questions', [])) for g in d.get('grammar', []))} câu ngữ pháp")

if errors:
    print("\nLỖI:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("OK")
