"""
test_real_voice_stt.py — ทดสอบข้อ (ก) ด้วยเสียงคนจริง (ไม่ใช่ TTS สังเคราะห์เหมือนรอบก่อน)

เตรียมไฟล์เสียงตามนี้ก่อนรัน:
  1. อัดเสียงจริงจากคนในทีม คนละ 5 ประโยค (มีคำว่า CAMT, DITC, SE, DII, MMIT) ใน 2 สภาพ:
     ห้องเงียบ / มีเสียงรอบข้าง ยืนห่างไมค์ ~1 เมตร (จำลองระยะจริงหน้าตู้)
  2. เซฟไฟล์เป็น .wav หรือ .m4a ก็ได้ (สคริปต์แปลงให้เอง) ตั้งชื่อไฟล์ให้มีคำว่า "personN" และ
     "qstnN" อยู่ในชื่อ (คั่นด้วย "_" หรือ "-" ก็ได้) เช่น person1-qstn1-quiet.m4a, person2_qstn3_noisy.wav
     วางไว้ในโฟลเดอร์ real_voice_samples/ (สร้างเองข้าง ๆ สคริปต์นี้ ไม่ต้อง commit เข้า git)
  3. รัน: cd backend && .venv/Scripts/python -m app.scripts.test_real_voice_stt [--vocab]

--vocab เปิด custom_vocabulary priming (ทดลองแก้ STT ที่ต้นเหตุ ก่อนจะพิจารณา alias หลัง retrieval)
ผลลัพธ์ไปที่ backend/real_voice_result[_vocab].txt

หมายเหตุสำคัญเรื่องเกณฑ์ตัดสิน "ถูก/ผิด" (แก้บั๊กจริงที่เจอ 2026-09-06): STT ถอดคำเป็นอักษรไทยตาม
เสียงที่พูดจริงไม่ใช่ความผิดพลาด — เช่น "CAMT" พูดออกเสียงเป็น "แคมป์" จริง ถอดมาแบบนั้นคือถูกต้อง
ต่างจาก "Disney"/"DC" ที่ฟังผิดคำไปเลย (ไม่ใช่การถอดเสียงข้ามสคริปต์ที่สมเหตุสมผล) ACCEPTED_TRANSLATIONS
ด้านล่างแยกสองกรณีนี้ชัดเจน — รายการของ DITC ใช้ตัวเดียวกับ `_DITC_ALIASES` ใน rag/retrieval.py
(single source of truth เดียวกับที่ normalize_query() ใช้จริงตอน production)
"""
from __future__ import annotations

import asyncio
import re
import subprocess
import sys
from pathlib import Path

from google import genai
from google.genai import types

from app.config import settings
from app.rag.retrieval import _DITC_ALIASES

# คอนโซล Windows บางแบบ (เช่น codepage cp874 เริ่มต้นของ Git Bash) เข้ารหัส Unicode เช่น ✓/✗ ไม่ได้
# แล้ว print() จะ crash ทั้งโปรแกรมทันที — reconfigure ให้ทนกว่านั้น (แทนที่ตัวที่เข้ารหัสไม่ได้แทนที่จะพัง)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MODEL = "gemini-3.1-flash-live-preview"
SAMPLES_DIR = Path(__file__).parent / "real_voice_samples"

# key = เลขข้อ, value = คำ "ตัวแทน" สำหรับแสดงผล/priming (ไม่ใช่ตัวเช็คคำตอบ — ดู ACCEPTED_TRANSLATIONS)
# แก้ข้อ 5 จาก DTM เดิมเป็น MMIT 2026-09-05: DTM เป็นปริญญาโท ผู้ใช้หน้าตู้ส่วนใหญ่สนใจปริญญาตรี
# MMIT (ปริญญาตรี) จึงสะท้อนคำถามจริงหน้างานมากกว่า
EXPECTED_KEYWORDS = {
    1: ["CAMT"],
    2: ["DITC"],
    3: ["SE"],
    4: ["DII"],
    5: ["MMIT"],
}

# คำตอบที่ "ถูกต้องจริง" ของแต่ละข้อ รวมการถอดเสียงข้ามสคริปต์ที่สมเหตุสมผล (ไม่ใช่ทุกคำที่ต่างจาก
# ตัวคำหลักถือว่าผิด — ต้องแยกจาก "ฟังผิดคำ" เช่น Disney/DC ซึ่งไม่อยู่ในลิสต์นี้โดยตั้งใจ)
ACCEPTED_TRANSLATIONS = {
    "CAMT": ["CAMT", "แคมป์"],
    "DITC": ["DITC", *_DITC_ALIASES],
    "SE": ["SE"],
    "DII": ["DII"],
    "MMIT": ["MMIT"],
}

CUSTOM_VOCABULARY = ["CAMT", "DITC", "SE", "DII", "MMIT"]

_QSTN_RE = re.compile(r"qstn0*(\d+)", re.IGNORECASE)


def to_pcm16k(path: Path) -> bytes:
    out_path = path.with_suffix(".pcm")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(path), "-ar", "16000", "-ac", "1", "-f", "s16le", str(out_path)],
        check=True, capture_output=True,
    )
    return out_path.read_bytes()


async def transcribe(client: genai.Client, pcm_bytes: bytes, use_vocab: bool) -> str:
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(
            # ล็อกภาษาเป็นไทย ไม่ปล่อย auto-detect — เจอจริงว่าไฟล์หนึ่ง (เงียบเหมือนกันทุกไฟล์) ถูก
            # เดาเป็นภาษาอินโดนีเซียทั้งประโยคโดยไม่มีเหตุผล ถ้าไม่ล็อกจะพังทั้งประโยคแบบสุ่มได้อีก
            language_codes=["th-TH"],
            custom_vocabulary=CUSTOM_VOCABULARY if use_vocab else None,
        ),
    )
    heard = ""

    async def _run() -> None:
        nonlocal heard
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            chunk_size = 640
            for i in range(0, len(pcm_bytes), chunk_size):
                await session.send_realtime_input(
                    audio=types.Blob(data=pcm_bytes[i : i + chunk_size], mime_type="audio/pcm;rate=16000")
                )
                await asyncio.sleep(0.02)
            await session.send_realtime_input(audio_stream_end=True)
            async for response in session.receive():
                if response.server_content and response.server_content.input_transcription:
                    piece = response.server_content.input_transcription.text
                    if piece:
                        heard += piece
                if response.server_content and response.server_content.turn_complete:
                    break

    try:
        await asyncio.wait_for(_run(), timeout=30)
    except asyncio.TimeoutError:
        heard += " [TIMEOUT]"
    return heard


async def main() -> None:
    use_vocab = "--vocab" in sys.argv

    if not SAMPLES_DIR.exists():
        print(f"ไม่พบโฟลเดอร์ {SAMPLES_DIR} — สร้างแล้ววางไฟล์เสียงตามคำอธิบายบนสุดของไฟล์นี้ก่อน")
        return

    files = sorted(SAMPLES_DIR.glob("*.wav")) + sorted(SAMPLES_DIR.glob("*.m4a"))
    if not files:
        print(f"ไม่พบไฟล์เสียงใน {SAMPLES_DIR}")
        return

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    suffix = "_vocab" if use_vocab else ""
    result_path = Path(__file__).parent.parent.parent / f"real_voice_result{suffix}.txt"
    out: list[str] = []
    total = 0
    hits = 0

    print(
        f"เจอ {len(files)} ไฟล์ — custom_vocabulary={'เปิด' if use_vocab else 'ปิด'}, "
        f"language_codes=['th-TH'] (ล็อกเสมอ) — แต่ละไฟล์ยิง API จริง อาจใช้เวลาไฟล์ละ ~5-30 วิ",
        flush=True,
    )

    for i, f in enumerate(files, 1):
        # รองรับทั้ง person1_quiet_1.wav และ person1-qstn1-quiet.m4a (จับเลขข้อจาก "qstnN" ในชื่อไฟล์
        # ก่อน ถ้าไม่เจอค่อย fallback ไปจับเลขท้ายสุดของชื่อไฟล์แบบเดิม)
        m = _QSTN_RE.search(f.stem)
        if m:
            idx = int(m.group(1))
        else:
            stem_parts = f.stem.split("_")
            idx = int(stem_parts[-1]) if stem_parts[-1].isdigit() else None
        expected_kw = EXPECTED_KEYWORDS.get(idx, [None])[0]
        accepted = ACCEPTED_TRANSLATIONS.get(expected_kw, [])
        if idx is None:
            print(f"เตือน: จับเลขข้อจากชื่อไฟล์ {f.name!r} ไม่ได้ — ข้ามการเทียบคำตอบ", flush=True)

        print(f"[{i}/{len(files)}] กำลังทดสอบ {f.name} ...", end=" ", flush=True)
        pcm = to_pcm16k(f)
        heard = await transcribe(client, pcm, use_vocab)
        found = bool(accepted) and any(alt in heard for alt in accepted)
        total += 1
        hits += int(found)
        mark = "✓" if found else "✗"
        print(f"{mark} ได้ยิน={heard!r}", flush=True)
        out.append(f"{mark} {f.name}: ได้ยิน = {heard!r} (คาดหวัง: {expected_kw}, ยอมรับ: {accepted})")
        # เขียนผลสะสมทุกไฟล์ ไม่ใช่รอจบหมดค่อยเขียน — เผื่อไฟล์หลัง ๆ error/timeout จะได้ไม่เสียผลที่ทำไปแล้ว
        result_path.write_text("\n".join(out), encoding="utf-8")

    if total:
        out.append(f"\nสรุป: {hits}/{total} = {hits/total:.0%}")
        result_path.write_text("\n".join(out), encoding="utf-8")

    print(f"done -> {result_path}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
