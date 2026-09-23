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
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

from app.config import settings
from app.database import SessionLocal
from app.models.enums import SessionEndReason, Speaker
from app.rag.embedding import get_embedder
from app.rag.retrieval import keyword_search, normalize_query, search
from app.services.session_tracker import SessionTracker
from app.services.viseme_timeline import TimedWord, build_viseme_timeline, build_word_aligned_viseme_timeline

logger = logging.getLogger("routers.voice")

router = APIRouter(prefix="/api/voice", tags=["voice"])

MODEL = "gemini-3.1-flash-live-preview"
OUTPUT_PCM_BYTES_PER_SECOND = 24_000 * 2  # PCM16 mono

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
    "เวลาพูดออกเสียงคำว่า \"CAMT\" ให้ออกเสียงเป็นคำเดียวคล้าย \"แคมท์\" เสมอ ห้ามสะกดทีละตัวอักษร "
    "(ซี-เอ-เอ็ม-ที) เด็ดขาด "
    "เวลาพูดออกเสียงคำว่า \"DITC\" ให้พูดพยางค์แรกเป็นคำไทย \"ดิ๊ด\" (เสียงตรีสูงคล้าย \"did\") ต่อด้วย "
    "ตัวอักษรภาษาอังกฤษ \"C\" ออกเสียงแบบภาษาอังกฤษล้วน ๆ (เหมือนพูดคำว่า \"see\" ในภาษาอังกฤษ) ต่อเนื่อง "
    "กันโดยไม่มีช่วงหยุด ห้ามแปลง \"C\" เป็นคำไทย \"ซี\" หรือ \"ซี่\" เด็ดขาด "
    "ห้ามสะกดทีละตัวอักษร (ดี-ไอ-ที-ซี) เด็ดขาด — กติกานี้ใช้เฉพาะตอนออกเสียงพูด ไม่เกี่ยวกับตอนเขียน "
    "หรืออ่านชื่อเต็มเป็นภาษาอังกฤษ "
    "กำลังคุยด้วยเสียงกับคนที่ยืนอยู่ตรงหน้า ตอบสั้น กระชับ 1-3 ประโยค เหมือนคนคุยกันจริง ๆ "
    "ห้ามใช้ bullet หรือเลขข้อ เพราะข้อความนี้จะถูกอ่านออกเสียง "
    "ตอบเป็นภาษาไทยเป็นค่าเริ่มต้นเสมอ เว้นแต่ผู้ใช้พูดกับคุณเป็นภาษาอื่นก่อน (เช่น อังกฤษ) ถึงค่อย "
    "สลับไปตอบเป็นภาษานั้นต่อ — ห้ามสลับไปตอบภาษาอื่นเองโดยผู้ใช้ไม่ได้พูดภาษานั้นก่อน "
    "ทุกคำถามที่เกี่ยวกับ CAMT/DITC ต้องเรียกใช้ tool search_camt_knowledge_base ก่อนเสมอ "
    "ห้ามตอบจากความรู้ทั่วไปของคุณเอง ให้ตอบจากผลที่ tool คืนมาเท่านั้น "
    "ผลที่ tool คืนมาอาจเป็นเนื้อหาที่ใกล้เคียงคำถามแต่ไม่ได้ตอบคำถามจริง ๆ ก็ได้ (ระบบค้นหาคืนผลลัพธ์ที่ "
    "ใกล้เคียงที่สุดเสมอ ต่อให้ไม่มีคำตอบจริงอยู่เลย) — อ่านให้แน่ใจก่อนว่าเนื้อหานั้นตอบคำถามที่ถูกถามจริง "
    "ถ้าไม่มีส่วนไหนตอบคำถามได้ตรง ๆ ให้บอกตามตรงว่ายังไม่มีข้อมูลเรื่องนี้ในตอนนี้ ห้ามเดาหรือแต่งคำตอบ "
    "ขึ้นมาเองจากเนื้อหาที่ไม่เกี่ยวข้องโดยเด็ดขาด "
    "ถ้าคำถามไม่เกี่ยวกับ CAMT/DITC เลย ให้เรียก tool flag_off_topic ก่อนเสมอ (ระบุหัวข้อที่ถูกถาม "
    "สั้น ๆ) แล้วค่อยปฏิเสธอย่างสุภาพว่าตอบได้เฉพาะเรื่อง CAMT/DITC แล้วชวนกลับเข้าหัวข้อ "
    "ห้ามเรียก flag_off_topic ถ้าคำถามเกี่ยวกับ CAMT/DITC จริง "
    "ข้อยกเว้น (ห้ามเรียก flag_off_topic เด็ดขาดสำหรับกรณีเหล่านี้ ให้ตอบเป็นมิตรสั้น ๆ แทน): "
    "(1) คำทักทายเฉย ๆ (เช่น \"สวัสดี\" \"หวัดดี\" \"hello\" หรือประโยคทักทายสั้น ๆ ไม่มีคำถามแนบมาด้วย) "
    "— ทักทายกลับ แนะนำตัวว่าเป็น DITC CAT แล้วถามว่าช่วยอะไรได้บ้าง "
    "(2) คุยเล่น/small talk สั้น ๆ ที่ไม่ใช่คำถามเกี่ยวกับ CAMT/DITC จริงจัง เช่น \"สบายดีไหม\" "
    "\"ขอบคุณครับ/ค่ะ\" \"เก่งจัง\" หรือคำถามเกี่ยวกับตัวแมวเอง (\"คุณชื่ออะไร\" \"คุณทำอะไรได้บ้าง\" "
    "\"คุณคือใคร\") — ตอบสั้น ๆ เป็นมิตรตามธรรมชาติ ถ้าเป็นคำถามเกี่ยวกับตัวเองให้บอกว่าเป็น DITC CAT "
    "ช่วยตอบคำถามเรื่อง CAMT/DITC ได้ "
    "ข้อยกเว้นทั้งสองข้อนี้ใช้เฉพาะกรณีที่ไม่มีคำถามอื่นเกี่ยวกับเรื่องนอกขอบเขต CAMT/DITC แนบมาด้วยเท่านั้น "
    "— ถ้ามีคำถามนอกขอบเขตจริงแนบมาด้วย (เช่น \"สวัสดีครับ ขอถามเรื่องดินฟ้าอากาศหน่อย\") ยังต้องเรียก "
    "flag_off_topic ตามปกติสำหรับส่วนคำถามนั้น "
    "เมื่อผู้ใช้พูดจบหนึ่งเทิร์น ให้ประเมินว่าผู้ใช้ต้องการจบบทสนทนาหรือไม่ เรียก tool "
    "flag_conversation_end เฉพาะเมื่อเข้าเงื่อนไขนี้เท่านั้น — "
    "เรียก (ถือว่าจบ): ประโยคเป็นการล่ำลาหรือปฏิเสธอย่างชัดเจน โดยไม่มีคำถามหรือคำขอแนบมาในประโยคเดียวกัน "
    "เช่น \"บายบาย\" \"แค่นี้แหละ\" \"พอแล้ว\" \"ไม่มีอะไรแล้ว\" \"ขอบคุณครับ\" (จบห้วน ๆ ไม่มีอะไรต่อท้าย) "
    "\"ขอบคุณมากค่ะ\" (ไม่มีคำถามตามมา) — "
    "ห้ามเรียก (ถือว่ายังไม่จบ): มีคำขอบคุณแต่ตามด้วยคำถาม คำขอ หรือคำเชื่อมที่บ่งชี้ว่าจะพูดต่อในประโยค "
    "เดียวกันหรือทันทีถัดไป เช่น \"ขอบคุณครับ แล้วถ้าอยากรู้เรื่อง...\" \"ขอบคุณค่ะ อีกอย่างนึงคือ...\" "
    "\"ขอบคุณ งั้นถามต่ออีกนิดนึงนะ\" หรือคำขอบคุณที่เป็นการตอบรับคำตอบก่อนหน้า แต่บริบทก่อนหน้ายังเป็น "
    "คำถามเปิดที่ผู้ใช้อาจถามต่อได้ตามธรรมชาติ — "
    "หากไม่แน่ใจว่าเข้าเงื่อนไขไหน ให้เลือกไม่เรียก แล้วปล่อยให้ระบบ silence timeout จัดการแทน การไม่ปิด "
    "session ไม่สร้างความเสียหาย แต่การเรียกผิดจังหวะทำให้บทสนทนาต่อเนื่องอันเดียวถูกนับเป็นสอง sessions "
    "ในข้อมูลสถิติ — tool นี้ใช้แค่นับสถิติเท่านั้น ไม่ตัดการเชื่อมต่อเสียงหรือหยุดคุยจริง หลังเรียกแล้ว "
    "ยังคุยต่อกับผู้ใช้ได้ตามปกติทุกประการถ้าผู้ใช้พูดต่อ"
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

# ฟีเจอร์นับ session ให้แม่นขึ้น: แยกเจตนา "จบบทสนทนา" ของผู้ใช้ออกจาก silence timeout 10 วิ
# (ดู session_tracker.py: flag_conversation_end()/pending_conversation_end()/close_now()) — เหมือน
# flag_off_topic ทุกประการ คือ structured tool call ให้ Gemini เรียกเอง ห้าม guess จาก keyword ใน
# transcript เด็ดขาด (โปรเจกต์นี้เจอปัญหา keyword พังมาแล้ว 2 รอบกับ off-topic/angry detection)
CONVERSATION_END_FUNCTION = types.FunctionDeclaration(
    name="flag_conversation_end",
    description=(
        "เรียกเมื่อผู้ใช้ส่งสัญญาณจบบทสนทนาอย่างชัดเจน (คำล่ำลา/ปฏิเสธ ไม่มีคำถามหรือคำขอแนบมาด้วยในเทิร์น "
        "เดียวกัน) ตามเกณฑ์ที่ system instruction กำหนด ใช้แค่สำหรับนับสถิติจำนวนบทสนทนาให้แม่นขึ้นเท่านั้น "
        "ไม่ตัดการเชื่อมต่อเสียงใด ๆ ทั้งสิ้น หลังเรียกแล้วยังคุยต่อกับผู้ใช้ได้ตามปกติ ถ้าไม่แน่ใจว่าจบจริง "
        "หรือไม่ ห้ามเรียก"
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={},
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

    # analytics session (สถิติหน้าแดชบอร์ด) แยกจาก WS/Gemini session นี้โดยเจตนา — ดูคอมเมนต์เต็ม
    # ที่ app/services/session_tracker.py ตัดขอบเขตด้วยความเงียบต่อเนื่อง ไม่ผูกกับ GoAway/reconnect
    # ของ Gemini เลย (record_turn() ถูกเรียกจาก speech_start/turn_complete ด้านล่างเท่านั้น)
    ws_connection_id = str(uuid.uuid4())
    tracker = SessionTracker(ws_connection_id)
    tracker.start()

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    def build_config(resumption_handle: str | None) -> types.LiveConnectConfig:
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            # ล็อกเสียงพากย์ไว้ตายตัว — ไม่ตั้งไว้แต่แรกทำให้ Gemini สุ่มเสียงชาย/หญิงเองทุก session ใหม่
            # (ผู้ใช้จริงได้ยินสลับไปมาไม่คงที่ทุกครั้งที่ปลุก ตรวจแล้วว่าไม่มี speech_config เลยในโค้ด)
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Despina"),
                ),
            ),
            output_audio_transcription=types.AudioTranscriptionConfig(mode="VERBATIM", word_timestamp=True),
            # จำกัด language_codes เสมอตามกฎ CLAUDE.md (ห้าม auto-detect เปิดกว้างทุกภาษา) — เคยเจอบั๊ก
            # เดาเป็นอินโดนีเซียมาแล้วจริงตอนทดสอบเสียงคนจริง (ดู docs/adr/voice-stt-real-world-test.md)
            # ไฟล์นี้ตกหล่นไปจาก voice_pipeline_dev.py ที่แก้ไว้แล้ว
            input_audio_transcription=types.AudioTranscriptionConfig(language_codes=["th-TH", "en-US"]),
            system_instruction=SYSTEM_INSTRUCTION,
            tools=[types.Tool(function_declarations=[SEARCH_FUNCTION, OFF_TOPIC_FUNCTION, CONVERSATION_END_FUNCTION])],
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

    async def browser_to_gemini(session) -> None:
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
                # สัญญาณ "ผู้ใช้เริ่มพูดจริง" ตัวเดียวกับที่ frontend ใช้ตัดสิน UI — ใช้เป็นจุดนับ
                # turn ของ analytics session ด้วย (ดู session_tracker.py) ไม่เกี่ยวกับ Gemini
                # activity_start ด้านล่างเลย เป็นคนละเรื่องกัน แค่เกิดพร้อมกัน
                tracker.record_turn(Speaker.USER)
                await session.send_realtime_input(activity_start=types.ActivityStart())
            elif msg.get("type") == "speech_end":
                await session.send_realtime_input(activity_end=types.ActivityEnd())

    async def gemini_to_browser(session, resumption_state: dict) -> None:
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
        turn_audio_bytes = 0
        turn_transcript = ""
        turn_words: list[TimedWord] = []
        turn_id = 1
        timeline_revision = 0
        last_timeline_duration_ms = 0

        async def send_viseme_timeline(*, final: bool = False) -> None:
            """Send a replaceable timeline snapshot tied to received PCM duration."""
            nonlocal timeline_revision, last_timeline_duration_ms
            duration_ms = round(turn_audio_bytes / OUTPUT_PCM_BYTES_PER_SECOND * 1000)
            if not turn_transcript.strip() or duration_ms <= 0:
                return
            timeline_revision += 1
            last_timeline_duration_ms = duration_ms
            timeline = (
                build_word_aligned_viseme_timeline(turn_words, duration_ms)
                if turn_words
                else build_viseme_timeline(turn_transcript, duration_ms)
            )
            await websocket.send_json(
                {
                    "type": "viseme_timeline",
                    "timeline": timeline,
                    "durationMs": duration_ms,
                    "text": turn_transcript,
                    "revision": timeline_revision,
                    "final": final,
                    "source": "word_timestamps" if turn_words else "text_fallback",
                    "turnId": turn_id,
                }
            )

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

                if response.server_content and getattr(response.server_content, "interrupted", False):
                    await websocket.send_json({"type": "viseme_interrupted", "turnId": turn_id})
                    turn_audio_bytes = 0
                    turn_transcript = ""
                    turn_words = []
                    turn_id += 1
                    timeline_revision = 0
                    last_timeline_duration_ms = 0

                if response.tool_call:
                    function_responses = []
                    for fc in response.tool_call.function_calls:
                        if fc.name == "flag_off_topic":
                            # ทาง (ข): flag เชิงโครงสร้างจากโมเดลเอง ไม่เดาจาก keyword ใน
                            # transcript — ถ้าโมเดลไม่เรียกตัวนี้ก็แค่ไม่โกรธ ไม่มี fallback
                            # เดาเอง (ตามที่ตกลงไว้ ห้าม guess จาก keyword เด็ดขาด)
                            topic = fc.args.get("topic", "")
                            logger.info("voice off-topic flagged: topic=%r", topic)
                            # สัญญาณให้ topic classifier ตอนปิด session (ดู session_tracker.py /
                            # topic_classifier.py) — เป็นคำที่ Gemini สรุปเอง ไม่ใช่คำพูดผู้ใช้ตรง ๆ
                            tracker.record_signal(topic)
                            # เกณฑ์ NOISE (ดู session_tracker.py): เรียก flag_off_topic = มีคำถาม
                            # จริงจากคนจริงแล้ว (แค่นอกขอบเขต) ไม่ใช่ NOISE ต่างจาก mark_knowledge_
                            # search_called ด้านล่าง (คนละความหมาย ต้องตั้งทั้งคู่แยกกัน)
                            tracker.mark_off_topic_flagged()
                            await websocket.send_json({"type": "off_topic"})
                            function_responses.append(
                                types.FunctionResponse(id=fc.id, name=fc.name, response={"result": "acknowledged"})
                            )
                            continue
                        if fc.name == "flag_conversation_end":
                            # แค่ตั้ง flag ไว้ก่อน — ตัด boundary จริงหลัง turn_complete ของเทิร์นนี้
                            # เอง (ดู gemini_to_browser ด้านล่าง) ไม่ใช่ตัดทันทีตรงนี้ ไม่งั้นประโยคลา
                            # สุดท้ายที่แมวกำลังจะพูด (ยังไม่จบเทิร์น ณ จุดที่ tool_call มาถึง) จะกลาย
                            # เป็น session ใหม่แยกเดี่ยว ๆ ที่มีแค่ turn ฝั่งบอท ไม่มี turn ผู้ใช้เลย —
                            # ดู docstring ของ flag_conversation_end() ใน session_tracker.py
                            logger.info("voice conversation-end flagged")
                            tracker.flag_conversation_end()
                            # แจ้ง frontend ทันที (feat/session-idle-sleep) — ไม่ใช่แค่ analytics
                            # boundary ของ tracker เท่านั้น frontend เอา flag นี้ไปตัด mic/WS จริงตอน
                            # เสียงลาพูดจบจริง (ดู useVoiceSocket.ts: "conversation_end" รอ hangover
                            # เดียวกับ BOT_SPEECH_END_HANGOVER_MS ก่อนตัด ไม่ใช่ตัดทันทีตรงนี้) ส่งแค่
                            # ข้อความบน WS ของเราเอง ไม่แตะ session.send_client_content()/
                            # send_realtime_input() ของ Gemini เลยสักจุด — ไม่เข้าเงื่อนไข interleaving
                            # ที่ SDK เตือนไว้ (ดู CLAUDE.md เรื่อง greet-first saga)
                            await websocket.send_json({"type": "conversation_end"})
                            function_responses.append(
                                types.FunctionResponse(id=fc.id, name=fc.name, response={"result": "acknowledged"})
                            )
                            continue
                        q = fc.args.get("query", "")
                        logger.info("voice tool call: query=%r", q)
                        # สัญญาณให้ topic classifier ตอนปิด session — query ผ่านการแปลงจาก Gemini
                        # แล้ว (ดู SEARCH_FUNCTION description) ไม่ใช่คำพูดผู้ใช้ตรง ๆ
                        tracker.record_signal(q)
                        # เกณฑ์ NOISE (ดู session_tracker.py): session ที่ไม่เคยเรียก tool นี้เลย
                        # ถือว่าไม่มีคำถามจริงเกี่ยวกับ CAMT/DITC — ต้องตั้ง flag ตรงนี้จุดเดียว
                        # (ไม่ใช่ที่ flag_off_topic ด้านบน ซึ่งหมายถึง "ถามนอกเรื่อง" ไม่ใช่ "ไม่ถามเลย")
                        tracker.mark_knowledge_search_called()
                        # run_retrieval บล็อก (DB + local embedding model) — รันใน executor กัน
                        # event loop ค้าง ไม่งั้นเสียงไมค์ที่กำลังส่งเข้า Gemini จะสะดุดระหว่างรอ
                        # (เหมือนที่แก้ไว้แล้วใน voice_pipeline_dev.py แต่ตกหล่นไปจากไฟล์นี้)
                        result_text = await loop.run_in_executor(None, run_retrieval, q)
                        function_responses.append(
                            types.FunctionResponse(id=fc.id, name=fc.name, response={"result": result_text})
                        )
                    await session.send_tool_response(function_responses=function_responses)

                if response.data is not None:
                    # diagnostic ถาวร (2026-09-14) — log ทุกก้อนเสียงที่มาถึงตลอด session (ไม่จำกัดช่วง)
                    # พร้อม timestamp+ขนาด ไว้เทียบกับ [input_stt_diag]/turn_complete ตอน debug จังหวะ
                    # เสียงเทียบกับ transcript ได้ตรงๆ โดยไม่ต้องเดา (เดิมเคยผูกไว้กับกลไก greet-first
                    # ที่ตัดออกไปแล้ว — ดู CLAUDE.md เรื่องเลิกใช้ send_client_content)
                    logger.info("[audio_arrival_diag] เสียงมาถึง: data_len=%d", len(response.data))
                    if turn_audio_bytes == 0:
                        await websocket.send_json({"type": "viseme_turn_start", "turnId": turn_id})
                    turn_audio_bytes += len(response.data)
                    await websocket.send_bytes(response.data)
                    current_duration_ms = round(turn_audio_bytes / OUTPUT_PCM_BYTES_PER_SECOND * 1000)
                    if turn_transcript and current_duration_ms - last_timeline_duration_ms >= 240:
                        await send_viseme_timeline()

                # getattr แบบ default None ตลอด — SDK จริงมี field นี้เสมอ (ดู build_config ที่ขอ
                # input_audio_transcription ไว้) แต่ test double (tests/test_voice_ws_multiturn.py ใช้
                # SimpleNamespace จำลอง response) ไม่ได้ตั้งค่านี้ไว้ครบทุกฟิลด์ — เข้าถึงตรงๆ จะพัง test
                input_transcription = getattr(response.server_content, "input_transcription", None) if response.server_content else None
                interim_input_transcription = (
                    getattr(response.server_content, "interim_input_transcription", None) if response.server_content else None
                )
                if input_transcription or interim_input_transcription:
                    # diagnostic ชั่วคราว (2026-09-14) — config ขอ input_audio_transcription ไว้อยู่แล้ว
                    # (ดู build_config) แต่ไม่เคยอ่าน/log field นี้เลยสักครั้งตั้งแต่ทำมา ทั้งที่นี่คือ
                    # สิ่งที่ Gemini "ได้ยิน" จริงจากเสียงที่ browser ส่งเข้าไป — เจ้าของงานสงสัยว่าตอน
                    # แมวพูดวนเองไม่หยุด (ตอบเรื่องห้องน้ำ/"I am a student"/"check your order" ทั้งที่พูด
                    # แค่ "สวัสดี") มีเสียงอะไรถูกส่งเข้า Gemini จริงหรือเปล่า log ตัวนี้จะตอบได้ตรงๆ ว่า
                    # Gemini ได้ยินอะไร (เสียงแมวเองที่หลุดเข้าไมค์ vs เสียงแวดล้อม vs อย่างอื่น)
                    logger.info(
                        "[input_stt_diag] Gemini ได้ยิน: final=%r interim=%r",
                        input_transcription.text if input_transcription else None,
                        interim_input_transcription.text if interim_input_transcription else None,
                    )

                if response.server_content and response.server_content.output_transcription:
                    output_transcription = response.server_content.output_transcription
                    text_piece = output_transcription.text
                    if text_piece:
                        # สัญญาณให้ topic classifier — ข้อความที่แมวพูดตอบเอง (ไม่ใช่คำพูดผู้ใช้)
                        # กันเคส greeting/small-talk ที่ไม่มีการเรียก tool เลยทั้งเทิร์น
                        tracker.record_signal(text_piece)
                        turn_transcript += text_piece
                        for word_info in getattr(output_transcription, "words", None) or []:
                            word = getattr(word_info, "word", None)
                            start_offset = getattr(word_info, "start_offset", None)
                            end_offset = getattr(word_info, "end_offset", None)
                            if not word or not start_offset or not end_offset:
                                continue
                            try:
                                timed_word: TimedWord = {
                                    "word": word,
                                    "startMs": round(float(start_offset.removesuffix("s")) * 1000),
                                    "endMs": round(float(end_offset.removesuffix("s")) * 1000),
                                }
                            except ValueError:
                                logger.warning("voice_ws: parse word timestamp ไม่ได้: %r-%r", start_offset, end_offset)
                                continue
                            if timed_word not in turn_words:
                                turn_words.append(timed_word)
                        await websocket.send_json({"type": "transcript", "text": text_piece})
                        await send_viseme_timeline()

                if response.server_content and response.server_content.turn_complete:
                    # ตัวเดียวกับที่ turn_complete ส่งให้ frontend — ใช้เป็นจุดนับ turn ฝั่งแมวของ
                    # analytics session ด้วย (ดู session_tracker.py) เกิดเฉพาะตอนเทิร์นจบจริง
                    # ไม่เกิดตอน GoAway (นั่นเป็นคนละ response type ไม่เข้า branch นี้)
                    tracker.record_turn(Speaker.BOT)
                    if tracker.pending_conversation_end():
                        # ตัด analytics session ตอนนี้ (หลัง turn ลาสุดท้ายถูกนับเข้า session เดิม
                        # เรียบร้อยแล้ว) ไม่แตะ WS/mic/audio ใด ๆ เลย — คุยต่อได้ปกติถ้ามีคนพูดต่อ
                        # (จะนับเป็น session ใหม่ทันทีเพราะ turns ถูกล้างไปแล้วที่นี่)
                        await tracker.close_now(SessionEndReason.USER_GOODBYE)
                    await send_viseme_timeline(final=True)
                    await websocket.send_json({"type": "turn_complete"})
                    turn_audio_bytes = 0
                    turn_transcript = ""
                    turn_words = []
                    turn_id += 1
                    timeline_revision = 0
                    last_timeline_duration_ms = 0

    resumption_handle: str | None = None
    consecutive_failures = 0

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
                        asyncio.create_task(browser_to_gemini(session)),
                        asyncio.create_task(gemini_to_browser(session, resumption_state)),
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
    finally:
        # ทำงานทุกทางออกจากฟังก์ชันนี้เสมอ (WS หลุดปกติ/error/แม้แต่ทางที่ปกติไม่ควรเกิด) — ปิด
        # watchdog task ของ analytics session แล้ว flush session ที่เปิดค้างอยู่ (ถ้ามี) กันไม่ให้
        # ค้างเป็น session ที่ไม่มีวันจบ ไม่เกี่ยวกับ Gemini/reconnect ที่จบไปแล้วก่อนถึงจุดนี้เสมอ
        await tracker.stop(SessionEndReason.UNKNOWN)
