"""
test_full_pipeline_answers.py — วัดสิ่งที่สำคัญจริง: จากเสียงคนจริง 20 ไฟล์ ระบบ "ตอบถูก" กี่ข้อ

ต่างจาก test_real_voice_stt.py (วัดแค่ STT ถอดตัวอักษรถูกไหม) — ไฟล์นี้ยิงเสียงเข้า Gemini Live
ด้วย config เดียวกับ production (routers/voice.py: SYSTEM_INSTRUCTION + SEARCH_FUNCTION tool +
run_retrieval จริงจาก DB) แล้ววัดว่า "คำตอบที่พูดออกมา" มีคำหลักที่ถูกต้องไหม — เพราะ transcript
ดิบถอดผิดไม่ได้แปลว่าคำตอบจะผิดตาม (โมเดลเข้าใจเจตนาจาก context ได้แม้ transcript จะเพี้ยน เห็นได้จาก
log การทดสอบ voice_pipeline_dev.py ก่อนหน้านี้ที่ transcript ขึ้น "Dead Sea คืออะไร" แต่ tool call
ยิง query "DITC คืออะไร" ถูกต้อง) ตัวเลขจากไฟล์นี้คือตัวที่เอาไปตัดสินใจ/รายงานอาจารย์ได้จริง

ข้อจำกัดที่ต้องรู้ก่อนอ่านผล: เช็คแค่ "คำหลักที่ถูกต้องปรากฏในคำตอบที่พูดออกมาไหม" (proxy สำหรับ
"ตอบถูกหัวข้อ+มีมูล") ไม่ใช่การเช็คความถูกต้องเชิงเนื้อหาลึกแบบมนุษย์อ่าน — อ่านคำตอบเต็มในไฟล์ผลลัพธ์
เพื่อสปอตเช็คด้วยตาอีกทีก่อนสรุปกับอาจารย์

รัน: cd backend && .venv/Scripts/python -m app.scripts.test_full_pipeline_answers
ผลลัพธ์ไปที่ backend/real_voice_pipeline_result.txt
"""
from __future__ import annotations

import asyncio
import re
import subprocess
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types

from app.config import settings
from app.rag.embedding import get_embedder
from app.routers.voice import MODEL, SEARCH_FUNCTION, SYSTEM_INSTRUCTION, run_retrieval
from app.scripts.test_real_voice_stt import ACCEPTED_TRANSLATIONS, EXPECTED_KEYWORDS, _QSTN_RE, to_pcm16k

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SAMPLES_DIR = Path(__file__).parent / "real_voice_samples"


async def run_one(client: genai.Client, pcm_bytes: bytes) -> tuple[str, list[str]]:
    """ส่งเสียงเข้า session เดียวกับ production ครบชุด คืน (คำตอบที่พูดออกมา, query ที่ tool ถูกเรียก)"""
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(language_codes=["th-TH"]),
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=[SEARCH_FUNCTION])],
    )
    answer = ""
    tool_queries: list[str] = []

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

            loop = asyncio.get_running_loop()
            async for response in session.receive():
                if response.tool_call:
                    for fc in response.tool_call.function_calls:
                        q = fc.args.get("query", "")
                        tool_queries.append(q)
                        result_text = await loop.run_in_executor(None, run_retrieval, q)
                        await session.send_tool_response(function_responses=[
                            types.FunctionResponse(id=fc.id, name=fc.name, response={"result": result_text})
                        ])
                if response.server_content and response.server_content.output_transcription:
                    piece = response.server_content.output_transcription.text
                    if piece:
                        answer += piece
                if response.server_content and response.server_content.turn_complete:
                    break

    try:
        await asyncio.wait_for(_run(), timeout=45)
    except asyncio.TimeoutError:
        answer += " [TIMEOUT]"
    return answer, tool_queries


async def main() -> None:
    if not SAMPLES_DIR.exists() or not list(SAMPLES_DIR.glob("*")):
        print(f"ไม่พบไฟล์เสียงใน {SAMPLES_DIR}")
        return

    files = sorted(SAMPLES_DIR.glob("*.wav")) + sorted(SAMPLES_DIR.glob("*.m4a"))
    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    result_path = Path(__file__).parent.parent.parent / "real_voice_pipeline_result.txt"
    out: list[str] = []
    total = 0
    hits = 0
    tool_called_count = 0

    print("กำลังโหลด embedding model ล่วงหน้า (กันไฟล์แรกช้าผิดปกติจาก cold start)...", flush=True)
    get_embedder()

    print(f"เจอ {len(files)} ไฟล์ — วัดคำตอบจริงผ่าน full pipeline (SYSTEM_INSTRUCTION+tool+retrieval)", flush=True)

    for i, f in enumerate(files, 1):
        m = _QSTN_RE.search(f.stem)
        idx = int(m.group(1)) if m else None
        expected_kw = EXPECTED_KEYWORDS.get(idx, [None])[0]
        accepted = ACCEPTED_TRANSLATIONS.get(expected_kw, [])

        print(f"[{i}/{len(files)}] {f.name} ...", end=" ", flush=True)
        pcm = to_pcm16k(f)
        t0 = time.perf_counter()
        answer, tool_queries = await run_one(client, pcm)
        dt = time.perf_counter() - t0

        called = bool(tool_queries)
        tool_called_count += called
        correct = bool(accepted) and any(alt in answer for alt in accepted)
        total += 1
        hits += int(correct)
        mark = "✓" if correct else "✗"
        print(f"{mark} ({dt:.1f}s, tool={'Y' if called else 'N'})", flush=True)
        out.append(
            f"{mark} {f.name} [{dt:.1f}s] เรียก tool={called} query={tool_queries!r}\n"
            f"    คำตอบ: {answer!r}\n"
            f"    คาดหวังคำ: {expected_kw} (ยอมรับ: {accepted})"
        )
        result_path.write_text("\n\n".join(out), encoding="utf-8")

    if total:
        out.append(
            f"\nสรุป: ตอบถูก {hits}/{total} = {hits/total:.0%} | เรียก tool {tool_called_count}/{total} ครั้ง"
        )
        result_path.write_text("\n\n".join(out), encoding="utf-8")

    print(f"done -> {result_path}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
