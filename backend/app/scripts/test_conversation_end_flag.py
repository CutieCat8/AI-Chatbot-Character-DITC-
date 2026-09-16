"""
test_conversation_end_flag.py — เทสจริงผ่าน Gemini Live ว่า flag_conversation_end ถูกเรียกถูกจังหวะ
ไหม ตามเกณฑ์ที่ SYSTEM_INSTRUCTION กำหนด (ดู routers/voice.py) — โดยเฉพาะประโยคที่ผสมสองแพทเทิร์นใน
ประโยคเดียว ("ขอบคุณ" + คำถามต่อ) ซึ่งเป็นเคสที่พรอมพ์อธิบายไว้แต่ไม่มีทางพิสูจน์ด้วย unit test ได้
(เป็นการตัดสินใจของโมเดลจริง ไม่ใช่ logic ในโค้ดเรา)

ใช้เสียงสังเคราะห์จาก gTTS ผ่าน session เดี่ยว ๆ (ไม่ผ่าน mic/browser จริง) ต่อ 1 ประโยคทดสอบ — เหมือน
spike_gemini_live_audio_in.py ทุกประการ ต่างแค่ตรวจว่า tool_call ไหนถูกเรียกแทนที่จะเช็ค STT accuracy

รัน: cd backend && .venv/Scripts/python -m app.scripts.test_conversation_end_flag
ผลลัพธ์ไปที่ conversation_end_flag_result.txt
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

from gtts import gTTS
from google import genai
from google.genai import types

from app.config import settings
from app.routers.voice import (
    CONVERSATION_END_FUNCTION,
    MODEL,
    OFF_TOPIC_FUNCTION,
    SEARCH_FUNCTION,
    SYSTEM_INSTRUCTION,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WORKDIR = Path(__file__).parent / "_spike_audio"

# (ประโยคทดสอบ, ควรเรียก flag_conversation_end ไหม, หมายเหตุ)
TEST_CASES: list[tuple[str, bool, str]] = [
    ("บายบาย", True, "ล่ำลาห้วน ๆ ไม่มีคำถามแนบ"),
    ("ขอบคุณครับ", True, "ขอบคุณห้วน ๆ ไม่มีอะไรต่อท้าย"),
    ("แค่นี้แหละครับ พอแล้ว", True, "ปฏิเสธชัดเจนว่าจบแล้ว"),
    ("ครับขอบคุณครับ เอาแค่นี้พอ", True, "เคสผสมจากพรอมพ์ผู้ว่าจ้าง — ขอบคุณ+ปฏิเสธในประโยคเดียว"),
    ("ขอบคุณครับ แล้วถ้าอยากรู้เรื่องค่าเทอมสาขา SE บ้างล่ะครับ", False, "ขอบคุณแต่มีคำถามต่อท้ายในประโยคเดียวกัน"),
    ("ขอบคุณค่ะ อีกอย่างนึงคือ อยากถามเรื่องหอพักด้วยค่ะ", False, "ขอบคุณแต่ตามด้วยคำขอเรื่องอื่นทันที"),
]


def synth(text: str, idx: int) -> bytes:
    WORKDIR.mkdir(exist_ok=True)
    mp3_path = WORKDIR / f"end_flag_{idx}.mp3"
    pcm_path = WORKDIR / f"end_flag_{idx}.pcm"
    gTTS(text=text, lang="th").save(str(mp3_path))
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp3_path), "-ar", "16000", "-ac", "1", "-f", "s16le", str(pcm_path)],
        check=True, capture_output=True,
    )
    return pcm_path.read_bytes()


async def run_one(client: genai.Client, pcm_bytes: bytes) -> tuple[list[str], str]:
    """คืน (ชื่อ tool ทั้งหมดที่ถูกเรียกในเทิร์นนี้, คำตอบที่พูดออกมา)"""
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(language_codes=["th-TH", "en-US"]),
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=[SEARCH_FUNCTION, OFF_TOPIC_FUNCTION, CONVERSATION_END_FUNCTION])],
    )
    called: list[str] = []
    answer = ""

    async def _run() -> None:
        nonlocal answer
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            chunk_size = 640
            for i in range(0, len(pcm_bytes), chunk_size):
                await session.send_realtime_input(
                    audio=types.Blob(data=pcm_bytes[i : i + chunk_size], mime_type="audio/pcm;rate=16000")
                )
                await asyncio.sleep(0.02)
            await session.send_realtime_input(audio_stream_end=True)

            async for response in session.receive():
                if response.tool_call:
                    function_responses = []
                    for fc in response.tool_call.function_calls:
                        called.append(fc.name)
                        function_responses.append(
                            types.FunctionResponse(id=fc.id, name=fc.name, response={"result": "ok"})
                        )
                    await session.send_tool_response(function_responses=function_responses)
                if response.server_content and response.server_content.output_transcription:
                    piece = response.server_content.output_transcription.text
                    if piece:
                        answer += piece
                if response.server_content and response.server_content.turn_complete:
                    break

    try:
        await asyncio.wait_for(_run(), timeout=30)
    except asyncio.TimeoutError:
        answer += " [TIMEOUT]"
    return called, answer


async def main() -> None:
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    result_path = Path(__file__).parent.parent.parent / "conversation_end_flag_result.txt"
    out: list[str] = []
    correct = 0

    for i, (phrase, expect_end, note) in enumerate(TEST_CASES, 1):
        print(f"[{i}/{len(TEST_CASES)}] {phrase!r} ...", end=" ", flush=True)
        pcm = synth(phrase, i)
        called, answer = await run_one(client, pcm)
        got_end = "flag_conversation_end" in called
        ok = got_end == expect_end
        correct += int(ok)
        mark = "✓" if ok else "✗"
        print(f"{mark} (called={called}, answer={answer!r})", flush=True)
        out.append(
            f"{mark} {phrase!r} [{note}]\n"
            f"    คาดหวัง flag_conversation_end={expect_end} | ได้จริง={got_end} | tool ที่เรียกทั้งหมด={called}\n"
            f"    คำตอบ: {answer!r}"
        )
        result_path.write_text("\n\n".join(out), encoding="utf-8")

    out.append(f"\nสรุป: ถูกต้อง {correct}/{len(TEST_CASES)}")
    result_path.write_text("\n\n".join(out), encoding="utf-8")
    print(f"done -> {result_path}")


if __name__ == "__main__":
    asyncio.run(main())
