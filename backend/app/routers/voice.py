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
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=[SEARCH_FUNCTION])],
    )

    try:
        async with client.aio.live.connect(model=MODEL, config=config) as session:

            async def browser_to_gemini() -> None:
                """รับเสียงไบนารีจาก browser ส่งต่อให้ Gemini Live แบบ real-time"""
                while True:
                    chunk = await websocket.receive_bytes()
                    await session.send_realtime_input(
                        audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000")
                    )

            async def gemini_to_browser() -> None:
                """รับเสียง/tool call จาก Gemini Live ส่งเสียงต่อให้ browser, จัดการ tool call เอง"""
                async for response in session.receive():
                    if response.tool_call:
                        function_responses = []
                        for fc in response.tool_call.function_calls:
                            q = fc.args.get("query", "")
                            logger.info("voice tool call: query=%r", q)
                            result_text = run_retrieval(q)
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

            await asyncio.gather(browser_to_gemini(), gemini_to_browser())

    except WebSocketDisconnect:
        logger.info("voice_ws: client disconnected")
    except Exception:
        logger.exception("voice_ws: error")
        try:
            await websocket.close(code=1011, reason="internal error")
        except RuntimeError:
            pass  # ปิดไปแล้ว
