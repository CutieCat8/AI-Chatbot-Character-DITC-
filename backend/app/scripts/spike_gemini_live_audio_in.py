"""
spike_gemini_live_audio_in.py — ทดสอบข้อ (ก) ที่ยังไม่เคยพิสูจน์จริง: ส่ง "เสียง" เข้า Live API
(ของเดิมใน spike_gemini_live.py ทดสอบแค่ส่งข้อความ ไม่ใช่เสียงจริง)

ใช้เสียงสังเคราะห์จาก gTTS (ภาษาไทย) แทนเสียงคนพูดจริง เป็น proxy ที่พอรับได้สำหรับเช็คว่า
Live API ถอดคำเฉพาะ (ชื่อคณะ/ศูนย์/ชื่อย่อหลักสูตร) ถูกไหม — ไม่ใช่การพิสูจน์คุณภาพ STT แบบสมบูรณ์
(เสียงคนพูดจริงมี accent/สภาพแวดล้อมกวนที่ synthetic เสียงไม่มี) แต่พอเป็นสัญญาณเตือนแรกได้

รัน: cd backend && .venv/Scripts/python -m app.scripts.spike_gemini_live_audio_in
ผลลัพธ์ไปที่ spike_audio_result.txt
"""
from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

from gtts import gTTS
from google import genai
from google.genai import types

from app.config import settings

MODEL = "gemini-3.1-flash-live-preview"

TEST_PHRASES = [
    "อยากทราบว่าคณะ CAMT มหาวิทยาลัยเชียงใหม่คืออะไร",
    "ศูนย์ DITC ทำอะไรบ้าง",
    "ค่าเทอมของสาขาวิศวกรรมซอฟต์แวร์ SE เท่าไหร่",
    "สาขา DII เรียนเกี่ยวกับอะไร ต่างจาก SE ยังไง",
    "อยากสมัครเรียนสาขา DTM ต้องมีคุณสมบัติอะไรบ้าง",
]

WORKDIR = Path(__file__).parent / "_spike_audio"


def synth(text: str, idx: int) -> bytes:
    WORKDIR.mkdir(exist_ok=True)
    mp3_path = WORKDIR / f"{idx}.mp3"
    wav_path = WORKDIR / f"{idx}.pcm"
    gTTS(text=text, lang="th").save(str(mp3_path))
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp3_path), "-ar", "16000", "-ac", "1", "-f", "s16le", str(wav_path)],
        check=True, capture_output=True,
    )
    return wav_path.read_bytes()


async def transcribe_one(client: genai.Client, pcm_bytes: bytes) -> str:
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )
    heard = ""

    async def _run() -> None:
        nonlocal heard
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            # ส่งเป็น chunk ๆ ละ ~20ms จับเวลาให้ใกล้เคียง real-time เหมือน mic จริง
            # (ส่งรัวทีเดียวทั้งไฟล์ทำให้ server-side automatic VAD ตัดสินใจ turn ผิดจังหวะ
            # เจอ error "the operation was aborted" — ต้อง pace ให้เหมือนเสียงพูดจริง)
            chunk_size = 640  # 16000Hz * 2 bytes * 0.02s
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
        heard += " [TIMEOUT 30s ไม่ตอบ]"
    return heard


async def main() -> list[str]:
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    log: list[str] = []
    for i, phrase in enumerate(TEST_PHRASES, 1):
        pcm = synth(phrase, i)
        heard = await transcribe_one(client, pcm)
        ok = "✓" if all(kw in heard for kw in _key_terms(phrase)) else "✗ (คำสำคัญหาย)"
        log.append(f"{i}. ต้นฉบับ: {phrase}")
        log.append(f"   Live ได้ยินว่า: {heard}")
        log.append(f"   {ok}")
        log.append("")
    return log


def _key_terms(phrase: str) -> list[str]:
    for term in ["CAMT", "DITC", "SE", "DII", "DTM"]:
        if term in phrase:
            return [term]
    return []


if __name__ == "__main__":
    lines = asyncio.run(main())
    out_path = Path(__file__).parent.parent.parent / "spike_audio_result.txt"
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"done -> {out_path}")
