"""
services/session_tracker.py — ตัดขอบเขต "analytics session" จากความเงียบต่อเนื่อง (PDPA-safe)

*** แยกจาก WS/Gemini session โดยเจตนา ***
  หนึ่ง WS connection (ws_connection_id) อาจมีได้หลาย analytics session ต่อกัน (เช่น ตู้เปิดค้าง
  ทั้งวัน คนคุยจบแล้วเดินไป คนถัดไปมาคุยต่อในหน้าจอเดิม) — watchdog ตัวนี้ตัดขอบเขตด้วยเกณฑ์เงียบ
  ต่อเนื่อง (Settings.BACKEND_SESSION_SILENCE_TIMEOUT_S) เท่านั้น **ไม่เกี่ยวกับ GoAway/reconnect
  ของ Gemini Live เลย** — record_turn() ถูกเรียกจาก speech_start (ผู้ใช้พูด) และ turn_complete
  (แมวพูดจบ) ใน routers/voice.py เท่านั้น ไม่มีจุดไหนใน reconnect loop เรียกฟังก์ชันนี้ ดังนั้น
  Gemini ส่ง GoAway มา (ทุก ~15 นาที) จะไม่ทำให้ watchdog เข้าใจผิดว่า session จบ

*** ไม่เก็บข้อความใด ๆ ลง DB — text อยู่ใน memory ชั่วคราวเท่านั้น ***
  record_turn() รับแค่ speaker (Speaker.USER/BOT) ไม่มีพารามิเตอร์ข้อความให้ใส่ผิดได้เลยแม้ไม่ตั้งใจ
  ส่วน record_signal() รับข้อความได้ (สำหรับ classifier — ดู topic_classifier.py) แต่เก็บใน memory
  ของอินสแตนซ์นี้เท่านั้น ไม่เขียนลง DB ที่ไหนเลย ถูกส่งให้ classifier ตอนปิด session แล้วทิ้งทันที
  (ดู _close_current_session) ConversationSession ที่ insert ตอนปิด session เขียนแค่ tags/other_hint
  ที่ classifier สรุปมา (ค่า enum/ข้อความสั้น ๆ) ไม่เคยเขียนสัญญาณดิบ — message_count นับจากจำนวน
  turn ที่เก็บได้จริง, status ตั้ง UNCLASSIFIED ไว้ก่อนเสมอตอน insert (classifier ไม่แตะ status —
  ดูเหตุผลใน topic_classifier.py)

*** ไม่บล็อก event loop ***
  record_turn()/record_signal() เป็น sync ล้วน (แค่ append list) ไม่มี await เลย — งาน DB ทั้งหมด
  (insert ตอนปิด session) รันผ่าน run_in_executor เหมือน run_retrieval ใน routers/voice.py กันไม่ให้
  เสียงที่กำลังส่ง/เล่นอยู่สะดุดตอนเขียน DB ส่วน classify (เรียก LLM จริง อาจช้าหลายวินาที) ยิงเป็น
  asyncio.create_task() แยกต่างหาก ไม่ await เลยจาก _close_current_session — การปิด session (insert
  แถว) กับการ classify (UPDATE แถวทีหลัง) จึงเป็นคนละจังหวะกันโดยสิ้นเชิง แถวใน DB ปรากฏทันทีเสมอ
  ไม่ว่า classify จะช้า/ล้มเหลวแค่ไหน

*** session ที่ไม่มี turn เลยไม่ถูกบันทึก ***
  ถ้า WS ต่อแล้วหลุดโดยไม่มีใครพูดอะไรเลย (ไม่มี speech_start/turn_complete แม้แต่ครั้งเดียว)
  จะไม่ insert แถวใน conversation_sessions เลย

*** NOISE — session ที่พูด/มี turn จริง แต่ไม่มีคำถามจริงเกี่ยวกับ CAMT/DITC ***
  เกณฑ์ (ตัดสินใจร่วมกับผู้ว่าจ้าง 2026-09-08): ถ้า session นั้นไม่เคยเรียก search_camt_knowledge_base
  เลยสักครั้ง (ดู mark_knowledge_search_called()) ถือว่าไม่มีคำถามจริงเกี่ยวกับ CAMT/DITC เลย — ตั้ง
  status=NOISE ตอน insert **และข้าม classify ไปเลย** (ไม่มีประโยชน์จะ classify หัวข้อของ session ที่
  ไม่มีคำถามจริง ประหยัด LLM call ไปด้วย) แถวยังถูก insert ปกติ (เห็นจำนวนได้ในแดชบอร์ด แยกต่างหาก
  จาก "จำนวนบทสนทนา" จริง — ดู routers/stats.py ที่ query แยก NOISE ออกจาก total เสมออยู่แล้ว)

  หมายเหตุ: เกณฑ์นี้ครอบคลุมทั้ง "คนเดินผ่าน/เสียงรบกวนไม่มีคำพูดที่เข้าใจได้" และ "ถามเรื่องนอก
  ขอบเขต CAMT/DITC ล้วน ๆ (flag_off_topic แต่ไม่เคยเรียก search เลย)" เป็น bucket เดียวกันตามที่
  ผู้ว่าจ้างสั่งไว้ตรง ๆ ไม่แยกย่อยเพิ่มเอง
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.config import settings
from app.database import SessionLocal
from app.models import ConversationSession, ConversationTurn
from app.models.enums import Language, SessionEndReason, SessionStatus, Speaker
from app.services.topic_classifier import classify_session_topics

logger = logging.getLogger("services.session_tracker")

# เก็บ reference ของ background classify task ไว้กัน GC (asyncio.create_task() ที่ไม่มีใครถือ
# reference ไว้เลยมีสิทธิ์โดนเก็บขยะทิ้งกลางทางได้ — เป็น pattern มาตรฐานตามเอกสาร asyncio)
_background_tasks: set[asyncio.Task] = set()


def _insert_closed_session(
    ws_connection_id: str,
    turns: list[tuple[Speaker, datetime]],
    started_at: datetime,
    ended_at: datetime,
    end_reason: SessionEndReason,
    status: SessionStatus,
) -> int:
    """sync — เรียกผ่าน loop.run_in_executor() เท่านั้น ห้ามเรียกตรงจาก event loop (blocking DB I/O)
    คืน id ของแถวที่ insert ไว้ให้ classify task เอาไป UPDATE ทีหลัง (ถ้าไม่ใช่ NOISE)

    status ตัดสินจาก _close_current_session ก่อนเรียกฟังก์ชันนี้แล้ว (NOISE ถ้าไม่เคยเรียก
    search_camt_knowledge_base เลยทั้ง session, ไม่งั้น UNCLASSIFIED เสมอ — classifier ไม่แตะ
    status อีกทีหลัง insert ดู topic_classifier.py)"""
    db = SessionLocal()
    try:
        session_row = ConversationSession(
            started_at=started_at,
            ended_at=ended_at,
            language=Language.TH,
            topic=None,
            tags=None,
            other_hint=None,
            message_count=len(turns),
            status=status,
            end_reason=end_reason,
        )
        db.add(session_row)
        db.add_all(
            ConversationTurn(ws_connection_id=ws_connection_id, speaker=speaker, occurred_at=occurred_at)
            for speaker, occurred_at in turns
        )
        db.commit()
        return session_row.id
    finally:
        db.close()


def _update_session_tags(session_id: int, tags: list[str], other_hint: str | None) -> None:
    """sync — เรียกผ่าน loop.run_in_executor() เท่านั้น เขียนแค่ tags/other_hint ที่ classifier
    สรุปมาแล้ว (ค่า enum/ข้อความสั้น ๆ ที่ผ่าน validate ใน topic_classifier.py แล้ว) ไม่เคยเขียน
    สัญญาณดิบ ไม่แตะคอลัมน์อื่น (status/end_reason/message_count เขียนไว้แล้วตอน insert)"""
    db = SessionLocal()
    try:
        session_row = db.get(ConversationSession, session_id)
        if session_row is None:  # แถวถูกลบไปแล้ว (ไม่ควรเกิดในทางปฏิบัติ) — ไม่มีอะไรให้ update
            logger.warning("session_tracker: session_id=%d หายไปก่อน classify เสร็จ", session_id)
            return
        session_row.tags = tags
        session_row.other_hint = other_hint
        db.commit()
    finally:
        db.close()


async def _classify_and_update(session_id: int, signals: list[str]) -> None:
    """background task แยกจาก _close_current_session โดยสิ้นเชิง (ไม่มีใคร await ตัวนี้เลย) —
    เรียก LLM (อาจช้าหลายวินาที) แล้ว UPDATE แถวที่ insert ไปแล้ว ล้มเหลวได้ทุกจุด (LLM error/parse
    ไม่ได้/แถวหาย) โดยไม่ทำให้ analytics session หาย เพราะแถวถูก insert ไปเรียบร้อยแล้วก่อนหน้านี้
    (ดู _close_current_session) — signals ที่รับมาเป็น local variable ในนี้เท่านั้น ไม่ถูกเก็บที่ไหน
    อีกเลยหลังฟังก์ชันนี้จบ (สำเร็จหรือล้มเหลวก็ตาม)"""
    if not signals:
        return  # ไม่มีสัญญาณให้ classify เลย (เช่น session ที่ไม่เคยเรียก tool/ไม่มี transcript)
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, classify_session_topics, signals)
    except Exception:
        logger.exception("session_tracker: classify ล้มเหลว (session_id=%d) — ปล่อย UNCLASSIFIED ไว้", session_id)
        return
    if result is None:
        logger.warning(
            "session_tracker: classifier คืนผลไม่สำเร็จ (session_id=%d) — ปล่อย UNCLASSIFIED ไว้", session_id
        )
        return
    tags, other_hint = result
    await loop.run_in_executor(None, _update_session_tags, session_id, tags, other_hint)


class SessionTracker:
    """หนึ่งอินสแตนซ์ต่อหนึ่ง WS connection — สร้างใน voice_ws() ทันทีหลัง accept()
    (ก่อน reconnect loop ของ Gemini) และ stop() ตอน voice_ws() จบไม่ว่าจะจบทางไหนก็ตาม"""

    def __init__(self, ws_connection_id: str, silence_timeout_s: float | None = None) -> None:
        self.ws_connection_id = ws_connection_id
        self._timeout_s = (
            silence_timeout_s if silence_timeout_s is not None else settings.BACKEND_SESSION_SILENCE_TIMEOUT_S
        )
        self._turns: list[tuple[Speaker, datetime]] = []
        self._signals: list[str] = []
        self._knowledge_search_called: bool = False
        self._session_started_at: datetime | None = None
        self._activity_event = asyncio.Event()
        self._watchdog_task: asyncio.Task | None = None

    def start(self) -> None:
        self._watchdog_task = asyncio.create_task(self._watchdog())

    def record_turn(self, speaker: Speaker) -> None:
        """เรียกจาก speech_start (Speaker.USER) / turn_complete (Speaker.BOT) ใน routers/voice.py
        เท่านั้น — ห้ามเรียกตอน GoAway/reconnect (นั่นไม่ใช่กิจกรรมของผู้ใช้จริง)"""
        now = datetime.now(timezone.utc)
        if self._session_started_at is None:
            self._session_started_at = now
        self._turns.append((speaker, now))
        self._activity_event.set()  # ปลุก watchdog ให้เริ่มนับเวลาใหม่

    def record_signal(self, text: str) -> None:
        """เก็บ "สัญญาณหัวข้อ" ไว้ใน memory ชั่วคราว สำหรับ classifier ใช้ตอนปิด session เท่านั้น
        (ดู topic_classifier.py) — เรียกได้จาก 3 จุดใน routers/voice.py เท่านั้น: query ที่ Gemini
        แปลงแล้วตอนเรียก search_camt_knowledge_base, topic ที่ Gemini สรุปตอนเรียก flag_off_topic,
        และข้อความที่แมวพูดตอบ (output_transcription)

        ***ห้ามเรียกด้วย input_audio_transcription (คำพูดดิบของผู้ใช้) เด็ดขาด แม้จะแค่ชั่วคราวก็ตาม***
        ตัดสินใจร่วมกับผู้ว่าจ้างไว้ชัดเจนว่าไม่ยอมเสี่ยง PDPA เกินจำเป็น — สัญญาณทั้งหมดที่รับได้จาก
        3 จุดข้างบนล้วนเป็นข้อความที่ตัวระบบ (Gemini) สร้าง/สรุปเองทั้งสิ้น ไม่ใช่คำพูดผู้ใช้ตรง ๆ
        ไม่มีการเรียกใช้ record_turn() ที่นี่ — ไม่ใช่จุดตัดสิน turn boundary"""
        if text:
            self._signals.append(text)

    def mark_knowledge_search_called(self) -> None:
        """เรียกจากจุดเดียวเท่านั้น: ตอน Gemini เรียก search_camt_knowledge_base จริงใน
        routers/voice.py (คนละจุดกับ record_signal(q) ที่เรียกพร้อมกันตรงนั้น — ตัวนี้แค่ตั้ง flag
        ไม่เก็บข้อความ) ใช้ตัดสินตอนปิด session ว่ามีคำถามจริงเกี่ยวกับ CAMT/DITC ไหม (ดู
        _close_current_session) — ไม่เรียกจาก flag_off_topic หรือ transcript เด็ดขาด เพราะเกณฑ์คือ
        "เรียก search จริง" ไม่ใช่ "มีสัญญาณอะไรก็ได้" (ตัดสินใจร่วมกับผู้ว่าจ้าง 2026-09-08)"""
        self._knowledge_search_called = True

    async def _watchdog(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            try:
                await asyncio.wait_for(self._activity_event.wait(), timeout=self._timeout_s)
                self._activity_event.clear()
                continue  # มีกิจกรรมใหม่ระหว่างรอ — เริ่มนับ timeout ใหม่ทั้งหมด
            except asyncio.TimeoutError:
                if self._turns:
                    logger.info(
                        "session_tracker: เงียบครบ %.0f วิ ปิด analytics session "
                        "(ws_connection_id=%s, turns=%d)",
                        self._timeout_s,
                        self.ws_connection_id,
                        len(self._turns),
                    )
                    await self._close_current_session(loop, SessionEndReason.TIMEOUT)
                # ไม่มี turn เลยตั้งแต่เปิด WS (หรือตั้งแต่ปิด session ล่าสุด) — ไม่มีอะไรต้องปิด
                # วนรอรอบถัดไปเฉย ๆ (wait_for บล็อกเต็ม ๆ ไม่ busy-loop)

    async def _close_current_session(
        self, loop: asyncio.AbstractEventLoop, end_reason: SessionEndReason
    ) -> None:
        if not self._turns:
            return
        turns = self._turns
        signals = self._signals
        knowledge_search_called = self._knowledge_search_called
        started_at = self._session_started_at
        ended_at = turns[-1][1]
        self._turns = []
        self._signals = []
        self._knowledge_search_called = False
        self._session_started_at = None
        assert started_at is not None

        # ไม่เคยเรียก search_camt_knowledge_base เลยทั้ง session = ไม่มีคำถามจริงเกี่ยวกับ CAMT/DITC
        # (คนเดินผ่าน/เสียงรบกวน/ถามนอกเรื่องล้วน ๆ) -> NOISE ดู docstring หัวไฟล์
        status = SessionStatus.UNCLASSIFIED if knowledge_search_called else SessionStatus.NOISE

        session_id = await loop.run_in_executor(
            None, _insert_closed_session, self.ws_connection_id, turns, started_at, ended_at, end_reason, status
        )

        if status == SessionStatus.NOISE:
            logger.info(
                "session_tracker: session_id=%d เป็น NOISE (ไม่เคยเรียก search_camt_knowledge_base) "
                "— ข้าม classify", session_id,
            )
            return  # ประหยัด LLM call — ไม่มีประโยชน์จะ classify หัวข้อของ session ที่ไม่มีคำถามจริง

        # ยิงเป็น background task แยกต่างหาก ไม่ await — แถวถูก insert ไปแล้วข้างบน (เห็นในแดชบอร์ด
        # ได้ทันที) ต่อให้ classify ใช้เวลาหลายวินาที/ล้มเหลว ก็ไม่หน่วง _close_current_session ที่
        # กำลัง return กลับไปให้ watchdog/stop() ทำงานต่อ (ดูเหตุผลเต็มที่ _classify_and_update)
        task = asyncio.create_task(_classify_and_update(session_id, signals))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    async def stop(self, end_reason: SessionEndReason = SessionEndReason.UNKNOWN) -> None:
        """เรียกตอน voice_ws() จบ (WS หลุดจริง ไม่ว่าจะกดหยุดเอง/ปิดแท็บ/เน็ตขาด/error) —
        ปิด watchdog task แล้ว flush session ที่เปิดค้างอยู่ (ถ้ามี) กันไม่ให้ค้างเป็น session
        ที่ไม่มีวันจบ"""
        if self._watchdog_task is not None:
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass
        loop = asyncio.get_running_loop()
        await self._close_current_session(loop, end_reason)
