"""
routers/voice.py — WebSocket bridge: mic เสียงจากเบราว์เซอร์ <-> Gemini Live <-> เสียงแมวตอบกลับ

สถาปัตยกรรม (ยืนยันด้วย spike แล้วทุกจุด ดู app/scripts/spike_gemini_live*.py):
  browser --(binary ws, PCM16 16kHz mono)--> เรา --(send_realtime_input)--> Gemini Live
  Gemini Live --(tool_call)--> เรา --(retrieval.py เดิม + DITC normalize)--> ส่งผลกลับ
  Gemini Live --(audio PCM16 24kHz mono)--> เรา --(binary ws)--> browser (เล่นเสียง)

เรื่อง reconnect/buffer: ฝั่งนี้ (backend) ทำแค่ relay ตรง ๆ ไม่ buffer เอง — การกันเสียงสะดุด
ตอนเน็ตไม่นิ่งต้องทำที่ฝั่ง browser (jitter buffer ก่อนเริ่มเล่น ~1-2s) เพราะบัฟเฟอร์ต้องอยู่ใกล้
ลำโพงที่สุดถึงจะกันสะดุดได้จริง ดู static/voice_test.html เป็นตัวอย่าง client ที่ทำ jitter buffer
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from app.config import settings
from app.database import SessionLocal
from app.rag.embedding import get_embedder
from app.rag.retrieval import keyword_search, normalize_query, search

logger = logging.getLogger("routers.voice")

router = APIRouter(prefix="/api/voice", tags=["voice"])

MODEL = "gemini-3.1-flash-live-preview"

SYSTEM_INSTRUCTION = (
    "คุณคือ DITC CAT ผู้ช่วยตอบคำถามของศูนย์ DITC และคณะ CAMT มหาวิทยาลัยเชียงใหม่เท่านั้น "
    "หมายเหตุ: ถ้าได้ยินคำว่า \"ITC\" \"ดิติซี\" หรือ \"ดีไอทีซี\" ให้เข้าใจว่าหมายถึง \"DITC\" เสมอ "
    "(STT มักถอดเสียง D ตัวแรกของ DITC หายไป) "
    "กำลังคุยด้วยเสียงกับคนที่ยืนอยู่ตรงหน้า ตอบสั้น กระชับ 1-3 ประโยค เหมือนคนคุยกันจริง ๆ "
    "ห้ามใช้ bullet หรือเลขข้อ เพราะข้อความนี้จะถูกอ่านออกเสียง "
    "ทุกคำถามที่เกี่ยวกับ CAMT/DITC ต้องเรียกใช้ tool search_camt_knowledge_base ก่อนเสมอ "
    "ห้ามตอบจากความรู้ทั่วไปของคุณเอง ให้ตอบจากผลที่ tool คืนมาเท่านั้น "
    "ถ้าคำถามไม่เกี่ยวกับ CAMT/DITC ให้ปฏิเสธอย่างสุภาพว่าตอบได้เฉพาะเรื่อง CAMT/DITC"
)

SEARCH_FUNCTION = types.FunctionDeclaration(
    name="search_camt_knowledge_base",
    description=(
        "ค้นข้อมูลหลักสูตร ข่าวสาร ค่าเทอม คุณสมบัติผู้สมัคร ฯลฯ ของศูนย์ DITC และคณะ CAMT "
        "มหาวิทยาลัยเชียงใหม่ จากฐานความรู้จริงที่เก็บไว้ ต้องเรียกก่อนตอบคำถามที่เกี่ยวกับ CAMT/DITC เสมอ"
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "query": types.Schema(type=types.Type.STRING, description="คำค้นภาษาไทย สั้น กระชับ ตรงประเด็น"),
        },
        required=["query"],
    ),
)


def run_retrieval(query: str) -> str:
    """เหมือนที่ routers/chat.py ใช้ทุกประการ (รวม DITC normalize) — ให้ Chat Demo กับตู้จริงตอบตรงกัน

    ลำดับ merge + top_k แก้แล้ว (2026-09-06, ดู docs/knowledge-base-audit.md): vector_results มาก่อน
    keyword_results เสมอ (เดิมสลับกัน ทำให้ keyword noise เบียด vector match ที่ถูกต้อง rank 1 ตกไป
    จาก [:6] ยืนยันจริงกับ query "เบอร์โทร CAMT"/"DITC มีโดรนให้ใช้ไหม") และเพิ่ม top_k vector
    4->12 (คำตอบถูกของคำถามค่าเทอม SE/DTM วัดจริงอยู่ rank 7-11 ไม่ใช่แค่ปัญหาลำดับ merge) — cap
    ผลลัพธ์สุดท้ายต้อง >= top_k ของ vector ด้วย ไม่งั้น vector มาก่อนก็จริงแต่ถ้า cap แคบกว่า
    (เจอบั๊กรอบแรกที่ cap=8 < top_k=12 ตัดรายการ rank 9-12 ทิ้งทั้งที่เป็นฝั่ง vector เอง) เลยตั้ง
    cap=12 ให้เท่ากับ top_k ของ vector พอดี รับประกันว่า vector ทั้งชุดผ่านแน่นอน
    """
    query = normalize_query(query)
    db = SessionLocal()
    try:
        vector_results = search(db, query, top_k=12, embedder=get_embedder())
        keyword_results = keyword_search(db, query, top_k=6, max_per_document=2)
        seen: set[int] = set()
        results = []
        for r in [*vector_results, *keyword_results]:
            if r.chunk_id not in seen:
                seen.add(r.chunk_id)
                results.append(r)
        results = results[:12]
        if not results:
            return "ไม่พบข้อมูลที่เกี่ยวข้องในฐานความรู้"
        return "\n\n".join(f"[{r.document_title or r.source_url}]\n{r.content}" for r in results)
    finally:
        db.close()


@router.websocket("/ws")
async def voice_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    if not settings.GEMINI_API_KEY:
        await websocket.close(code=1011, reason="ไม่มี GEMINI_API_KEY ใน .env")
        return

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # จำกัด language_codes เสมอตามกฎ CLAUDE.md (ห้าม auto-detect เปิดกว้างทุกภาษา) — เคยเจอบั๊ก
        # เดาเป็นอินโดนีเซียมาแล้วจริงตอนทดสอบเสียงคนจริง (ดู docs/adr/voice-stt-real-world-test.md)
        # ไฟล์นี้ตกหล่นไปจาก voice_pipeline_dev.py ที่แก้ไว้แล้ว
        input_audio_transcription=types.AudioTranscriptionConfig(language_codes=["th-TH", "en-US"]),
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=[SEARCH_FUNCTION])],
        # ปิด automatic_activity_detection ของ Gemini เอง + ให้ browser (useVoiceSocket.ts) เป็นคนบอก
        # จุดเริ่ม/จบพูดเองผ่านข้อความ {"type":"speech_start"|"speech_end"} แทน (2026-09-06 แก้บั๊ก
        # "คุยได้แค่รอบเดียวต่อการกดปุ่ม") — วินิจฉัยแล้วว่า AAD ของโมเดลนี้ (gemini-3.1-flash-live-
        # preview) ตรวจจับ "เริ่มพูด" ได้แค่ครั้งแรกของ session เท่านั้น ไม่ re-arm ให้จับรอบสอง
        # อัตโนมัติ ไม่เกี่ยวกับ half-duplex/tool-calling/transcription เลย (ทดสอบแยกเดี่ยวนอกแอปนี้
        # ตัดตัวแปรออกทีละตัวจนเหลือ config เปลือยที่สุดก็ยังพัง) — เหมือนที่แก้ใน voice_pipeline_dev.py
        # ทุกประการ ต่างแค่ว่าตัว "VAD" ที่นี่คือ local RMS ฝั่ง browser แทน silero-vad ฝั่ง Python
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True),
        ),
    )

    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:

            async def browser_to_gemini() -> None:
                """รับจาก browser: เสียงไบนารี ส่งต่อ Gemini แบบ real-time, ข้อความ JSON (speech_start/
                speech_end จาก local RMS ฝั่ง browser) แปลงเป็น activity_start/activity_end ให้ Gemini
                (AAD ปิดอยู่ ต้องบอกเองทุกครั้ง ไม่ใช่แค่ตอนเปิด session — ดูคอมเมนต์ตอนสร้าง config)"""
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        # .receive() ดิบไม่เหมือน receive_bytes()/receive_text() ที่ raise
                        # WebSocketDisconnect ให้เอง ต้องเช็ค+raise เองตรงนี้ ไม่งั้นจะวน .receive()
                        # ซ้ำแล้ว Starlette โยน RuntimeError แทน (ปิด ws ปกติแต่ log เป็น error ผิด ๆ)
                        raise WebSocketDisconnect(code=message.get("code", 1000))
                    data = message.get("bytes")
                    if data is not None:
                        await session.send_realtime_input(
                            audio=types.Blob(data=data, mime_type="audio/pcm;rate=16000")
                        )
                        continue
                    text = message.get("text")
                    if text is None:
                        continue
                    try:
                        msg = json.loads(text)
                    except json.JSONDecodeError:
                        logger.warning("voice_ws: ข้อความ JSON parse ไม่ได้: %r", text)
                        continue
                    if msg.get("type") == "speech_start":
                        await session.send_realtime_input(activity_start=types.ActivityStart())
                    elif msg.get("type") == "speech_end":
                        await session.send_realtime_input(activity_end=types.ActivityEnd())

            async def gemini_to_browser() -> None:
                """รับเสียง/tool call จาก Gemini Live ส่งเสียงต่อให้ browser, จัดการ tool call เอง

                สำคัญ: session.receive() ของ SDK คืน "1 เทิร์นจบก็ break" เสมอ (ดู
                google/genai/live.py: `while result := await self._receive(): ... if turn_complete:
                yield result; break; yield result`) ไม่ใช่ stream ทั้ง session — ต้องเรียกใหม่ทุกเทิร์น
                ไม่งั้นพอเทิร์นแรกจบ for-loop ก็จบไปด้วย ฟังก์ชันนี้ return แล้วไม่มีใครรอฟัง Gemini อีก
                เลย (เจอบั๊กนี้จริง 2026-09-06: เทิร์น 2 เงียบสนิทแม้ปิด AAD แล้ว เพราะ gemini_to_browser
                ตายไปตั้งแต่เทิร์น 1 ทั้งที่ browser_to_gemini ยังส่ง audio/activity เข้า Gemini ปกติ)"""
                loop = asyncio.get_running_loop()
                while True:
                    async for response in session.receive():
                        if response.tool_call:
                            function_responses = []
                            for fc in response.tool_call.function_calls:
                                q = fc.args.get("query", "")
                                logger.info("voice tool call: query=%r", q)
                                # run_retrieval บล็อก (DB + local embedding model) — รันใน executor กัน
                                # event loop ค้าง ไม่งั้นเสียงไมค์ที่กำลังส่งเข้า Gemini จะสะดุดระหว่างรอ
                                # (เหมือนที่แก้ไว้แล้วใน voice_pipeline_dev.py แต่ตกหล่นไปจากไฟล์นี้)
                                result_text = await loop.run_in_executor(None, run_retrieval, q)
                                function_responses.append(
                                    types.FunctionResponse(id=fc.id, name=fc.name, response={"result": result_text})
                                )
                            await session.send_tool_response(function_responses=function_responses)

                        if response.data is not None:
                            await websocket.send_bytes(response.data)

                        if response.server_content and response.server_content.output_transcription:
                            text_piece = response.server_content.output_transcription.text
                            if text_piece:
                                await websocket.send_json({"type": "transcript", "text": text_piece})

                        if response.server_content and response.server_content.turn_complete:
                            await websocket.send_json({"type": "turn_complete"})

            # ทั้งสอง task วิ่งตลอดอายุ connection แล้ว (ตั้งแต่แก้ gemini_to_browser ให้ while True
            # ครอบ session.receive() ใหม่ทุกเทิร์น) ตัวเดียวที่จบได้ปกติคือ browser_to_gemini ตอน
            # WebSocketDisconnect — ต้อง cancel อีก task ที่เหลือเองเสมอ ไม่งั้น async with ปิด session
            # ทิ้งไปแล้ว แต่ gemini_to_browser ยังพยายาม await session.receive() ต่อ กลายเป็น "Task
            # exception was never retrieved" (เหมือนที่ voice_pipeline_dev.py จัดการไว้แล้วใน finally)
            tasks = [asyncio.create_task(browser_to_gemini()), asyncio.create_task(gemini_to_browser())]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in tasks:
                    if not t.done():
                        t.cancel()
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for r in results:
                    if isinstance(r, BaseException) and not isinstance(r, asyncio.CancelledError):
                        raise r

    except WebSocketDisconnect:
        logger.info("voice_ws: client disconnected")
    except Exception:
        logger.exception("voice_ws: error")
        try:
            await websocket.close(code=1011, reason="internal error")
        except RuntimeError:
            pass  # ปิดไปแล้ว
