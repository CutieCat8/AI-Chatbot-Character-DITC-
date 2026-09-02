"""
test_real_voice_stt.py — ทดสอบข้อ (ก) ด้วยเสียงคนจริง (ไม่ใช่ TTS สังเคราะห์เหมือนรอบก่อน)

เตรียมไฟล์เสียงตามนี้ก่อนรัน:
  1. อัดเสียงจริงจากคนในทีม 3 คน คนละ 5 ประโยค (ใช้ประโยคชุดเดียวกับที่เคยเทสด้วย TTS
     เพื่อเทียบผลตรง ๆ ได้ — มีคำว่า CAMT, DITC, SE, DII, DTM) ใน 2 สภาพ: ห้องเงียบ / โถงมีคนคุย
     ยืนห่างไมค์ ~1 เมตร (จำลองระยะจริงหน้าตู้)
  2. เซฟไฟล์เป็น .wav หรือ .m4a ก็ได้ (สคริปต์แปลงให้เอง) ตั้งชื่อไฟล์ตามรูปแบบ:
     <คนที่>_<สภาพ>_<ข้อที่>.wav  เช่น person1_quiet_1.wav, person1_noisy_1.wav
     วางไว้ในโฟลเดอร์ real_voice_samples/ (สร้างเองข้าง ๆ สคริปต์นี้ ไม่ต้อง commit เข้า git)
  3. รัน: cd backend && .venv/Scripts/python -m app.scripts.test_real_voice_stt

ผลลัพธ์ไปที่ backend/real_voice_result.txt — เทียบ recall ต่อคนต่อสภาพ ต่างจากรอบ TTS
"""
from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from google import genai
from google.genai import types

from app.config import settings

MODEL = "gemini-3.1-flash-live-preview"
SAMPLES_DIR = Path(__file__).parent / "real_voice_samples"

# ต้องตรงกับชุดที่ทดสอบรอบ TTS (spike_gemini_live_audio_in.py) เพื่อเทียบผลได้ตรง ๆ
EXPECTED_KEYWORDS = {
    1: ["CAMT"],
    2: ["DITC"],
    3: ["SE"],
    4: ["DII"],
    5: ["DTM"],
}


def to_pcm16k(path: Path) -> bytes:
    out_path = path.with_suffix(".pcm")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(path), "-ar", "16000", "-ac", "1", "-f", "s16le", str(out_path)],
        check=True, capture_output=True,
    )
    return out_path.read_bytes()


async def transcribe(client: genai.Client, pcm_bytes: bytes) -> str:
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
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
    if not SAMPLES_DIR.exists():
        print(f"ไม่พบโฟลเดอร์ {SAMPLES_DIR} — สร้างแล้ววางไฟล์เสียงตามคำอธิบายบนสุดของไฟล์นี้ก่อน")
        return

    files = sorted(SAMPLES_DIR.glob("*.wav")) + sorted(SAMPLES_DIR.glob("*.m4a"))
    if not files:
        print(f"ไม่พบไฟล์เสียงใน {SAMPLES_DIR}")
        return

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    out: list[str] = []
    total = 0
    hits = 0

    for f in files:
        # คาดหวังชื่อไฟล์แบบ person1_quiet_1.wav
        stem_parts = f.stem.split("_")
        idx = int(stem_parts[-1]) if stem_parts[-1].isdigit() else None
        expected = EXPECTED_KEYWORDS.get(idx, [])

        pcm = to_pcm16k(f)
        heard = await transcribe(client, pcm)
        found = bool(expected) and any(kw in heard for kw in expected)
        total += 1
        hits += int(found)
        mark = "✓" if found else "✗"
        out.append(f"{mark} {f.name}: ได้ยิน = {heard!r} (คาดหวัง: {expected})")

    if total:
        out.append(f"\nสรุป: {hits}/{total} = {hits/total:.0%}")

    result_path = Path(__file__).parent.parent.parent / "real_voice_result.txt"
    result_path.write_text("\n".join(out), encoding="utf-8")
    print(f"done -> {result_path}")


if __name__ == "__main__":
    asyncio.run(main())
