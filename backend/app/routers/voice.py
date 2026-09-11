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

# Gemini Live จำกัดอายุ session แบบ audio-only ไว้ที่ 15 นาที (เอกสาร:
# https://ai.google.dev/gemini-api/docs/live-session) ก่อนตัดจริงจะส่ง "GoAway" มาล่วงหน้า ~60s
# (มี time_left บอกเวลาที่เหลือ) — ต้อง reconnect ไปหา Gemini ใหม่ด้วย session resumption handle
# ก่อนจะถูกตัดจริง ไม่งั้นตู้ (มีกระจกครอบ กดปุ่มเริ่มคุยใหม่เองไม่ได้) จะเงียบสนิทกลางบทสนทนาจนกว่า
# จะมีคนไปแตะเครื่อง — ดู reconnect loop ใน voice_ws() ด้านล่าง สำคัญ: การ reconnect ทั้งหมดเกิดขึ้น
# "ฝั่ง Gemini" เท่านั้น (client.aio.live.connect ใหม่) ไม่แตะ WebSocket ระหว่าง browser<->backend
# เลยสักครั้ง — เพราะ session ที่มี duration limit จริง ๆ คือฝั่ง Gemini Live ไม่ใช่ WS ของ browser
# (WS ของ browser ไม่มี limit นี้) ผลคือ frontend ไม่เห็น/ไม่ต้องรู้เรื่อง reconnect นี้เลย คุยต่อเนื่อง
# เหมือนไม่มีอะไรเกิดขึ้นจริง ๆ (useVoiceSocket.ts ไม่ต้องแก้อะไรเพิ่มสำหรับเรื่องนี้)
MAX_CONSECUTIVE_GEMINI_RECONNECT_FAILURES = 5
GEMINI_RECONNECT_BACKOFF_S = 2.0

SYSTEM_INSTRUCTION = (
    "คุณคือ DITC CAT ผู้ช่วยตอบคำถามของศูนย์ DITC และคณะ CAMT มหาวิทยาลัยเชียงใหม่เท่านั้น "
    "หมายเหตุ: ถ้าได้ยินคำว่า \"ITC\" \"ดิติซี\" หรือ \"ดีไอทีซี\" ให้เข้าใจว่าหมายถึง \"DITC\" เสมอ "
    "(STT มักถอดเสียง D ตัวแรกของ DITC หายไป) "
    "กำลังคุยด้วยเสียงกับคนที่ยืนอยู่ตรงหน้า ตอบสั้น กระชับ 1-3 ประโยค เหมือนคนคุยกันจริง ๆ "
    "ห้ามใช้ bullet หรือเลขข้อ เพราะข้อความนี้จะถูกอ่านออกเสียง "
    "ทุกคำถามที่เกี่ยวกับ CAMT/DITC ต้องเรียกใช้ tool search_camt_knowledge_base ก่อนเสมอ "
    "ห้ามตอบจากความรู้ทั่วไปของคุณเอง ให้ตอบจากผลที่ tool คืนมาเท่านั้น "
    "ถ้าคำถามไม่เกี่ยวกับ CAMT/DITC เลย ให้เรียก tool flag_off_topic ก่อนเสมอ (ระบุหัวข้อที่ถูกถาม "
    "สั้น ๆ) แล้วค่อยปฏิเสธอย่างสุภาพว่าตอบได้เฉพาะเรื่อง CAMT/DITC แล้วชวนกลับเข้าหัวข้อ "
    "ห้ามเรียก flag_off_topic ถ้าคำถามเกี่ยวกับ CAMT/DITC จริง"
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

# ทาง (ข) จากที่คุยกัน: ให้ Gemini คืน flag เชิงโครงสร้างเวลาจะปฏิเสธคำถามนอกขอบเขต แทนการเดาจาก
# keyword ใน transcript (ปัดทางนั้นทิ้งแล้ว — Gemini ไม่ใช้ประโยคปฏิเสธคำเดิมทุกครั้ง keyword พังง่าย
# และ false positive ของ keyword คือแมวโกรธใส่คำถามปกติ ซึ่งแย่กว่าการที่โมเดลลืมเรียก tool บางครั้ง
# ถ้าไม่ได้ flag ก็แค่ไม่โกรธ ไม่มีอะไรพัง) ดู docs/adr/ หรือ session ก่อนหน้าสำหรับการเปรียบเทียบเต็ม
OFF_TOPIC_FUNCTION = types.FunctionDeclaration(
    name="flag_off_topic",
    description=(
        "เรียกฟังก์ชันนี้ทุกครั้งก่อนจะปฏิเสธคำถามเพราะไม่เกี่ยวกับ CAMT/DITC เลย "
        "(ตามที่ system instruction กำหนด) ห้ามเรียกถ้าคำถามอยู่ในขอบเขต CAMT/DITC จริง"
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "topic": types.Schema(type=types.Type.STRING, description="สรุปสั้น ๆ ว่าผู้ใช้ถามเรื่องอะไร (ไว้ดู log เฉย ๆ ไม่ใช้ตัดสินอะไรต่อ)"),
        },
        required=["topic"],
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

    def build_config(resumption_handle: str | None) -> types.LiveConnectConfig:
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=types.AudioTranscriptionConfig(),
            # จำกัด language_codes เสมอตามกฎ CLAUDE.md (ห้าม auto-detect เปิดกว้างทุกภาษา) — เคยเจอบั๊ก
            # เดาเป็นอินโดนีเซียมาแล้วจริงตอนทดสอบเสียงคนจริง (ดู docs/adr/voice-stt-real-world-test.md)
            # ไฟล์นี้ตกหล่นไปจาก voice_pipeline_dev.py ที่แก้ไว้แล้ว
            input_audio_transcription=types.AudioTranscriptionConfig(language_codes=["th-TH", "en-US"]),
            system_instruction=SYSTEM_INSTRUCTION,
            tools=[types.Tool(function_declarations=[SEARCH_FUNCTION, OFF_TOPIC_FUNCTION])],
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
            # handle=None รอบแรก (เริ่ม session ใหม่ปกติ) รอบถัดไปหลัง GoAway จะใส่ handle ล่าสุดที่เก็บ
            # จาก session_resumption_update เพื่อต่อบทสนทนาเดิม ไม่ใช่เริ่มนับหนึ่งใหม่ (ดูคอมเมนต์
            # MAX_CONSECUTIVE_GEMINI_RECONNECT_FAILURES ด้านบน)
            session_resumption=types.SessionResumptionConfig(handle=resumption_handle),
        )

    async def browser_to_gemini(session, greet_pending: dict) -> None:
        """รับจาก browser: เสียงไบนารี ส่งต่อ Gemini แบบ real-time, ข้อความ JSON (speech_start/
        speech_end จาก local RMS ฝั่ง browser) แปลงเป็น activity_start/activity_end ให้ Gemini
        (AAD ปิดอยู่ ต้องบอกเองทุกครั้ง ไม่ใช่แค่ตอนเปิด session — ดูคอมเมนต์ตอนสร้าง config)

        รับ session เป็นพารามิเตอร์ (ไม่ใช่ closure จาก connect() ตัวเดียวคงที่ตลอด) เพราะตอน
        reconnect หา Gemini ใหม่ (GoAway) ต้องสร้าง task คู่นี้ใหม่ผูกกับ session ใหม่ทุกรอบ — ตัว
        WebSocket ของ browser (`websocket`) ตัวเดียวกันตลอด ไม่เคยถูกปิด/สร้างใหม่เลย
        """
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
                # ผู้ใช้เริ่มพูดจริงแล้ว = ช่วง greet_first synthetic turn จบแน่นอน (ถ้ายังไม่จบเอง
                # ด้วยเหตุผลอื่น) เคลียร์ที่นี่กัน flag ค้าง True ตลอด session ในเคสปกติที่สุด — Gemini
                # ทักทายเฉยๆ ไม่เรียก tool อะไรเลย ไม่มีจุดไหนอื่นมา consume flag นี้ให้ (เจอจริงจาก code
                # review 2026-09-11: ถ้าไม่เคลียร์ตรงนี้ คำถามนอกขอบเขตจริงครั้งแรกของผู้ใช้จะโดนกลืนไป
                # ด้วย ไม่ขึ้นหน้าโกรธทั้งที่ควรขึ้น)
                greet_pending["active"] = False
                await session.send_realtime_input(activity_start=types.ActivityStart())
            elif msg.get("type") == "speech_end":
                await session.send_realtime_input(activity_end=types.ActivityEnd())
            elif msg.get("type") == "greet_first":
                # เฉพาะทาง wake-word (frontend: useVoiceSocket.ts connect({greetFirst:true}), เรียก
                # จาก App.tsx useWakeWord onDetected เท่านั้น — ปุ่ม "เริ่มคุย" ไม่ส่งข้อความนี้) ผู้ใช้
                # เพิ่งเรียกด้วยเสียงไม่มีปุ่มให้กดยืนยันอีกที เลยให้แมวทักทายก่อนเองแทนที่จะนั่งรอเงียบๆ
                # ใช้ send_client_content (ไม่ใช่ send_realtime_input) เพราะเป็น turn สังเคราะห์ ไม่มี
                # เสียงจริงจากผู้ใช้ — ระบุชัดว่าเป็นข้อความระบบ ห้ามเรียก tool ใดๆ กันโมเดลพยายาม
                # search_camt_knowledge_base ทั้งที่ไม่มีคำถามจริง (ดู SYSTEM_INSTRUCTION ข้อกำหนดเรียก
                # tool ก่อนตอบทุกคำถาม) — SYSTEM_INSTRUCTION เองก็สั่ง "เรียก flag_off_topic ก่อนเสมอ"
                # แบบไม่มีข้อยกเว้น เลยตั้ง greet_pending ไว้ให้ gemini_to_browser กันไม่ให้ flag แรก
                # (ถ้าโมเดลตีความ trigger นี้เป็นคำถามนอกขอบเขตแล้วเรียกจริง) ทำหน้าโกรธผู้ใช้ทันทีที่ตื่น
                #
                # ห่อ try/except เฉพาะจุดนี้ — ถ้า Gemini reject/error ต้อง log แล้วปล่อยผ่าน ไม่ใช่ปล่อย
                # ให้ exception หลุดออกจาก while True loop (จะทำให้ browser_to_gemini task ทั้งอันตาย
                # session รีคอนเนกต์ทิ้ง resumption handle ทั้งที่ผู้ใช้แค่ไม่ได้คำทักทาย ควรแค่เงียบแล้ว
                # รอผู้ใช้พูดเองตามปกติแทน)
                greet_pending["active"] = True
                try:
                    await session.send_client_content(
                        turns=types.Content(
                            role="user",
                            parts=[types.Part(text=(
                                "(ข้อความระบบ ไม่ใช่คำถามจากผู้ใช้จริง — ห้ามเรียก tool ใดๆ สำหรับข้อความนี้) "
                                "ผู้ใช้เพิ่งเดินมาถึงตู้และเรียกคุณด้วยเสียง ทักทายสั้น ๆ 1 ประโยคเป็นภาษาไทยก่อน "
                                "แนะนำตัวว่าเป็น DITC CAT แล้วถามว่าช่วยอะไรได้บ้าง (ผู้ใช้อาจพูดต่อเป็นภาษาอังกฤษ "
                                "ก็ได้ ให้ตอบตามภาษาที่ผู้ใช้ใช้ต่อไปเรื่อย ๆ ไม่ต้องล็อกเป็นไทยทั้งบทสนทนา)"
                            ))],
                        ),
                        turn_complete=True,
                    )
                except Exception:
                    logger.exception("voice_ws: greet_first ส่งไม่สำเร็จ ปล่อยผ่านให้ผู้ใช้พูดเองตามปกติ")
                    greet_pending["active"] = False

    async def gemini_to_browser(session, resumption_state: dict, greet_pending: dict) -> None:
        """รับเสียง/tool call จาก Gemini Live ส่งเสียงต่อให้ browser, จัดการ tool call เอง

        สำคัญ: session.receive() ของ SDK คืน "1 เทิร์นจบก็ break" เสมอ (ดู
        google/genai/live.py: `while result := await self._receive(): ... if turn_complete:
        yield result; break; yield result`) ไม่ใช่ stream ทั้ง session — ต้องเรียกใหม่ทุกเทิร์น
        ไม่งั้นพอเทิร์นแรกจบ for-loop ก็จบไปด้วย ฟังก์ชันนี้ return แล้วไม่มีใครรอฟัง Gemini อีก
        เลย (เจอบั๊กนี้จริง 2026-09-06: เทิร์น 2 เงียบสนิทแม้ปิด AAD แล้ว เพราะ gemini_to_browser
        ตายไปตั้งแต่เทิร์น 1 ทั้งที่ browser_to_gemini ยังส่ง audio/activity เข้า Gemini ปกติ)

        resumption_state คือ dict กลาง (ไม่ใช่ return value) เพราะฟังก์ชันนี้ต้อง "return เฉย ๆ" ตอนเจอ
        GoAway (ไม่ raise) ให้ outer loop รู้ว่าต้อง reconnect หา Gemini ใหม่ — ใส่ resumption_state["go_away"]
        = True ไว้ให้ outer loop เช็คแทนการใช้ return value ตรง ๆ (asyncio.gather เก็บแค่ exception/return
        ปกติ ใช้ dict ส่งสถานะออกง่ายกว่า)
        """
        loop = asyncio.get_running_loop()
        while True:
            async for response in session.receive():
                if response.session_resumption_update and response.session_resumption_update.resumable:
                    # เก็บ handle ล่าสุดไว้ตลอด session (อัปเดตทุกครั้งที่ Gemini ส่งมาใหม่ ไม่ใช่แค่
                    # ครั้งเดียวตอนต่อ) ต้องเช็ค resumable ด้วย — ถ้า false แปลว่า ณ จุดนี้ resume ไม่ได้
                    # จริง (เช่น กำลัง generate อยู่พอดี) new_handle จะว่างเปล่า ห้ามทับ handle เก่าที่ดีอยู่
                    resumption_state["handle"] = response.session_resumption_update.new_handle

                if response.go_away:
                    # ได้รับแจ้งล่วงหน้า ~60s ก่อนโดนตัดจริง (เอกสาร Gemini Live) — ไม่รอให้ตัดจริงแล้ว
                    # ค่อยจัดการ (นั่นคือบั๊กเดิมที่ทำให้ตู้เงียบสนิท) ให้ return ทันทีเพื่อให้ outer loop
                    # ไป reconnect หา Gemini ใหม่ด้วย handle ที่เก็บไว้ล่าสุด — ไม่แตะ WebSocket ของ
                    # browser เลย (คุยต่อเนื่องจากมุมมองผู้ใช้ ไม่มีอะไรเกิดขึ้นให้เห็น)
                    logger.warning(
                        "voice_ws: ได้รับ GoAway จาก Gemini Live (time_left=%s) — จะ reconnect ด้วย session resumption",
                        response.go_away.time_left,
                    )
                    resumption_state["go_away"] = True
                    return

                if response.tool_call:
                    function_responses = []
                    for fc in response.tool_call.function_calls:
                        if fc.name == "flag_off_topic":
                            # ทาง (ข): flag เชิงโครงสร้างจากโมเดลเอง ไม่เดาจาก keyword ใน
                            # transcript — ถ้าโมเดลไม่เรียกตัวนี้ก็แค่ไม่โกรธ ไม่มี fallback
                            # เดาเอง (ตามที่ตกลงไว้ ห้าม guess จาก keyword เด็ดขาด)
                            topic = fc.args.get("topic", "")
                            logger.info("voice off-topic flagged: topic=%r", topic)
                            if greet_pending["active"]:
                                # กันแมวหน้าโกรธทันทีตอนตื่นจาก wake-word ถ้าโมเดลตีความ trigger
                                # ประโยคทักทายสังเคราะห์ (greet_first) เป็นคำถามนอกขอบเขต — consume
                                # แค่ครั้งเดียว (ไม่รอ turn_complete) กันค้าง True ตลอด session ถ้า
                                # send_client_content ฝั่ง browser_to_gemini fail ไปแล้วไม่มี turn ให้จบ
                                greet_pending["active"] = False
                                logger.info("voice_ws: กัน off_topic จาก greet_first synthetic turn")
                            else:
                                await websocket.send_json({"type": "off_topic"})
                            function_responses.append(
                                types.FunctionResponse(id=fc.id, name=fc.name, response={"result": "acknowledged"})
                            )
                            continue
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

    resumption_handle: str | None = None
    consecutive_failures = 0
    # เก็บนอก while True (ไม่ใช่ต่อรอบ reconnect) เพราะ greet_first เกิดครั้งเดียวตอนต่อ session แรกสุด
    # เท่านั้น (frontend ส่งตอน ws.onopen ครั้งเดียว) แต่ต้องรอด flag ข้าม reconnect ได้ถ้า GoAway มาไว
    # ผิดปกติก่อน greet turn จะจบ — ไม่ใช่ปัญหาจริงที่เคยเจอ แค่กันไว้เผื่อ
    greet_pending = {"active": False}

    try:
        while True:
            config = build_config(resumption_handle)
            resumption_state: dict = {"handle": resumption_handle, "go_away": False}
            try:
                async with client.aio.live.connect(model=MODEL, config=config) as session:
                    consecutive_failures = 0  # ต่อกับ Gemini สำเร็จรอบนี้ ล้างตัวนับความล้มเหลวต่อเนื่อง

                    # ทั้งสอง task วิ่งตลอดอายุ session ของ Gemini รอบนี้ (ตั้งแต่แก้ gemini_to_browser
                    # ให้ while True ครอบ session.receive() ใหม่ทุกเทิร์น) จบได้ 2 แบบ: (1) browser
                    # หลุดจริง (WebSocketDisconnect จาก browser_to_gemini) หรือ (2) Gemini ส่ง GoAway มา
                    # (gemini_to_browser return เฉย ๆ ไม่ raise) — ต้อง cancel อีก task ที่เหลือเองเสมอ
                    # ไม่งั้น async with ปิด session ทิ้งไปแล้ว แต่ gemini_to_browser ยังพยายาม await
                    # session.receive() ต่อ กลายเป็น "Task exception was never retrieved"
                    tasks = [
                        asyncio.create_task(browser_to_gemini(session, greet_pending)),
                        asyncio.create_task(gemini_to_browser(session, resumption_state, greet_pending)),
                    ]
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

                resumption_handle = resumption_state["handle"]
            except WebSocketDisconnect:
                # ผู้ใช้กดหยุดเอง/ปิดแท็บจริง ๆ — ไม่ใช่ GoAway ห้าม reconnect ปล่อยให้ except ชั้นนอก
                # จัดการ (log แล้วจบฟังก์ชันไปเลย เหมือนพฤติกรรมเดิมทุกประการ)
                raise
            except Exception:
                # error จริงจากฝั่ง Gemini (ไม่ใช่ GoAway ที่จัดการเป็น resumption_state["go_away"]
                # แยกไว้ต่างหากด้านบนแล้ว) เช่น API key ผิด/โควต้าหมด/เน็ตเบราว์เซอร์<->Gemini หลุด —
                # ลองต่อใหม่ได้จำกัดจำนวนครั้ง (MAX_CONSECUTIVE_GEMINI_RECONNECT_FAILURES) กันวนไม่รู้จบ
                # ถ้าปัญหาไม่หายเอง (เช่น API key ผิดจริง ต่อยังไงก็ไม่มีทางสำเร็จ)
                consecutive_failures += 1
                logger.exception(
                    "voice_ws: เชื่อมต่อ Gemini Live ไม่สำเร็จ (ครั้งที่ %d ติดต่อกัน)", consecutive_failures
                )
                if consecutive_failures >= MAX_CONSECUTIVE_GEMINI_RECONNECT_FAILURES:
                    raise
                await asyncio.sleep(GEMINI_RECONNECT_BACKOFF_S)
                continue

            if not resumption_state["go_away"]:
                # จบเพราะเหตุอื่นที่ไม่ใช่ GoAway (ปกติไม่ควรเกิด เพราะ WebSocketDisconnect ถูก raise
                # แล้วโดน except ด้านบนจับไปก่อนหน้านี้แล้ว) เผื่อไว้กันลูปค้าง ไม่ reconnect ต่อ
                break
            # GoAway -> วนกลับไป reconnect หา Gemini ใหม่ด้วย resumption_handle ที่เก็บไว้ ไม่แตะ
            # WebSocket ของ browser เลยสักบรรทัด (ดูคอมเมนต์ยาวที่ MAX_CONSECUTIVE_GEMINI_RECONNECT_FAILURES)

    except WebSocketDisconnect:
        logger.info("voice_ws: client disconnected")
    except Exception:
        logger.exception("voice_ws: error")
        try:
            await websocket.close(code=1011, reason="internal error")
        except RuntimeError:
            pass  # ปิดไปแล้ว
