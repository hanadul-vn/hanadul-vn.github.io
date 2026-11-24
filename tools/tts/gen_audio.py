#!/usr/bin/env python3
"""Tạo sẵn file âm thanh cho đề thi thử Nghe bằng Google Cloud Text-to-Speech (giọng Chirp 3 HD).

Mỗi bộ câu (set) của đề part "nghe" thành 1 file MP3: đọc lần lượt các câu thoại, người nói 남자 dùng giọng nam,
여자 dùng giọng nữ, giữa hai câu nghỉ ngắn. Thêm 1 file "Nghe thử" cho trang giới thiệu đề.
File lưu ở data/audio/<mã đề>/NN-<hash>.mp3; hash lấy từ lời thoại, nên sửa lời thoại thì file cũ hết khớp
(tools/check_data.py báo lỗi) và lần chạy sau chỉ đọc lại đúng bộ câu đã sửa. Danh sách file ghi vào trường
"audio" của file đề; assets/exam.js phát file này, thiếu file thì quay về giọng đọc của trình duyệt.

Chạy (cần ffmpeg):
  GOOGLE_TTS_API_KEY=... python3 tools/tts/gen_audio.py            # mọi đề Nghe, chỉ tạo file còn thiếu
  python3 tools/tts/gen_audio.py --exams nghe-01 --force            # đọc lại toàn bộ đề nghe-01
  python3 tools/tts/gen_audio.py --dry-run                          # chỉ đếm số ký tự sẽ gửi đi, không cần key
  python3 tools/tts/gen_audio.py --fake                             # âm thanh giả (tiếng bíp), để thử quy trình không cần key
Thường chạy qua GitHub Action "Tạo âm thanh đề Nghe" (.github/workflows/tts.yml), key để trong Secret GOOGLE_TTS_API_KEY.
"""
import argparse
import base64
import hashlib
import io
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EX_DIR = ROOT / "data/exams"
API = "https://texttospeech.googleapis.com/v1/text:synthesize"
RATE = 24000
VOICES = {"female": "ko-KR-Chirp3-HD-Kore", "male": "ko-KR-Chirp3-HD-Charon"}
SAMPLE_TEXT = "안녕하세요. 듣기 시험을 시작하겠습니다."
BY = "Google Cloud Text-to-Speech · Chirp 3 HD"
OLD_NOTE = "Âm thanh là giọng đọc máy của trình duyệt."
NEW_NOTE = "Âm thanh là giọng đọc AI (Google) thu sẵn; máy không tải được file thì đọc bằng giọng của trình duyệt."


def lines_hash(lines):
    """Hash 8 ký tự của lời thoại; tools/check_data.py và test dùng đúng công thức này."""
    return hashlib.sha1(json.dumps(lines, ensure_ascii=False).encode("utf-8")).hexdigest()[:8]


def is_female(speaker, order):
    if re.search(r"여자|여$|^W$", speaker):
        return True
    if re.search(r"남자|남$|^M$", speaker):
        return False
    return order % 2 == 1


class Synth:
    def __init__(self, key, fake, speaking_rate):
        self.key, self.fake, self.rate = key, fake, speaking_rate
        self.chars = 0

    def pcm(self, text, female):
        """Trả về PCM 16-bit mono RATE Hz."""
        self.chars += len(text)
        if self.fake:
            n = int(RATE * max(0.4, len(text) * 0.12))
            f = 660 if female else 330
            cyc = b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * i * f / RATE))) for i in range(RATE // f))
            return (cyc * (n // len(cyc) * 2 + 2))[:n * 2]
        body = {
            "input": {"text": text},
            "voice": {"languageCode": "ko-KR", "name": VOICES["female" if female else "male"]},
            "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": RATE, "speakingRate": self.rate},
        }
        data = self._call(body)
        with wave.open(io.BytesIO(data)) as w:
            if w.getframerate() != RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise SystemExit(f"Âm thanh trả về không đúng định dạng: {w.getframerate()} Hz, {w.getnchannels()} kênh")
            return w.readframes(w.getnframes())

    def _call(self, body):
        req = urllib.request.Request(API, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "X-Goog-Api-Key": self.key})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return base64.b64decode(json.loads(r.read())["audioContent"])
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")[:500]
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise SystemExit(f"Google TTS lỗi {e.code}: {msg}")
            except urllib.error.URLError as e:
                if attempt < 4:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise SystemExit(f"Không gọi được Google TTS: {e}")


def silence(sec):
    return b"\x00\x00" * int(RATE * sec)


def to_mp3(pcm, out):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
        tmp = t.name
    try:
        with wave.open(tmp, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-ac", "1", "-ar", str(RATE),
                        "-codec:a", "libmp3lame", "-b:a", "48k", str(out)], check=True)
    finally:
        os.unlink(tmp)


def process(eid, synth, force, dry):
    f = EX_DIR / f"{eid}.json"
    raw = f.read_text(encoding="utf-8")
    ex = json.loads(raw)
    if ex.get("part") != "nghe":
        print(f"{eid}: không phải đề Nghe, bỏ qua")
        return
    rel = f"data/audio/{eid}"
    out_dir = ROOT / rel
    old = ex.get("audio") or {}
    files, made = [], 0
    for si, st in enumerate(ex["sets"]):
        lines = st["lines"]
        name = f"{si + 1:02d}-{lines_hash(lines)}.mp3"
        files.append(name)
        if not force and (out_dir / name).exists():
            continue
        if dry:
            synth.chars += sum(len(l[1]) for l in lines)
            continue
        who, pcm = [], silence(0.3)
        for i, (sp, text) in enumerate(lines):
            if sp not in who:
                who.append(sp)
            if i:
                pcm += silence(0.8)
            pcm += synth.pcm(text, is_female(sp, who.index(sp)))
        pcm += silence(0.3)
        out_dir.mkdir(parents=True, exist_ok=True)
        to_mp3(pcm, out_dir / name)
        made += 1
        print(f"  {eid} bộ {si + 1}: {name}")
    sample = f"thu-{lines_hash([['여자', SAMPLE_TEXT]])}.mp3"
    if dry:
        if force or not (out_dir / sample).exists():
            synth.chars += len(SAMPLE_TEXT)
        print(f"{eid}: {len(files)} bộ câu")
        return
    if force or not (out_dir / sample).exists():
        out_dir.mkdir(parents=True, exist_ok=True)
        to_mp3(silence(0.2) + synth.pcm(SAMPLE_TEXT, True) + silence(0.2), out_dir / sample)
        made += 1
    keep = set(files) | {sample}
    for p in out_dir.glob("*.mp3"):
        if p.name not in keep:
            p.unlink()
            print(f"  xóa file cũ {p.name}")
    ex["audio"] = {"dir": rel, "by": "Âm thanh giả để thử (tiếng bíp)" if synth.fake else BY, "sample": sample, "files": files}
    if OLD_NOTE in ex.get("note", ""):
        ex["note"] = ex["note"].replace(OLD_NOTE, NEW_NOTE)
    text = json.dumps(ex, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else "")
    if text != raw:
        f.write_text(text, encoding="utf-8")
    size = sum((out_dir / n).stat().st_size for n in keep) // 1024
    print(f"{eid}: tạo {made} file, tổng {len(keep)} file, {size} KB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exams", default="all", help="mã đề, cách nhau dấu phẩy (mặc định: mọi đề Nghe)")
    ap.add_argument("--force", action="store_true", help="đọc lại cả file đã có")
    ap.add_argument("--dry-run", action="store_true", help="chỉ đếm số ký tự")
    ap.add_argument("--fake", action="store_true", help="âm thanh giả, không gọi Google")
    ap.add_argument("--rate", type=float, default=float(os.environ.get("TTS_RATE") or 1.0), help="tốc độ đọc (mặc định 1.0)")
    a = ap.parse_args()
    key = os.environ.get("GOOGLE_TTS_API_KEY", "").strip()
    if not (key or a.fake or a.dry_run):
        raise SystemExit("Thiếu GOOGLE_TTS_API_KEY (thêm vào Settings → Secrets and variables → Actions của repo).")
    idx = json.loads((EX_DIR / "index.json").read_text(encoding="utf-8"))
    ids = [e["id"] for e in idx["exams"] if e.get("part") == "nghe"] if a.exams == "all" else [x.strip() for x in a.exams.split(",") if x.strip()]
    synth = Synth(key, a.fake, a.rate)
    for eid in ids:
        if not re.fullmatch(r"[a-z0-9-]+", eid) or not (EX_DIR / f"{eid}.json").exists():
            raise SystemExit(f"Không có đề {eid!r}")
        process(eid, synth, a.force, a.dry_run)
    print(f"Tổng ký tự {'sẽ ' if a.dry_run else ''}gửi Google: {synth.chars}")


if __name__ == "__main__":
    sys.exit(main())
