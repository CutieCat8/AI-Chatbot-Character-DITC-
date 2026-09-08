"""
services/session_tracker.py — ตัดขอบเขต "analytics session" จากความเงียบต่อเนื่อง (PDPA-safe)

*** แยกจาก WS/Gemini session โดยเจตนา ***
  หนึ่ง WS connection (ws_connection_id) อาจมีได้หลาย analytics session ต่อกัน (เช่น ตู้เปิดค้าง
  ทั้งวัน คนคุยจบแล้วเดินไป คนถัดไปมาคุยต่อในหน้าจอเดิม) — watchdog ตัวนี้ตัดขอบเขตด้วยเกณฑ์เงียบ
  ต่อเนื่อง (Settings.BACKEND_SESSION_SILENCE_TIMEOUT_S) เท่านั้น **ไม่เกี่ยวกับ GoAway/reconnect
  ของ Gemini Live เลย** — record_turn() ถูกเรียกจาก speech_start (ผู้ใช้พูด) และ turn_complete
  (แมวพูดจบ) ใน routers/voice.py เท่านั้น ไม่มีจุดไหนใน reconnect loop เรียกฟังก์ชันนี้ ดังนั้น
  Gemini ส่ง GoAway มา (ทุก ~15 นาที) จะไม่ทำให้ watchdog เข้าใจผิดว่า session จบ

*** ไม่เก็บข้อความใด ๆ ***
  record_turn() รับแค่ speaker (Speaker.USER/BOT) ไม่มีพารามิเตอร์ข้อความให้ใส่ผิดได้เลยแม้ไม่ตั้งใจ
  ConversationSession ที่ insert ตอนปิด session ในไฟล์นี้ยังไม่มี tags/topic/other_hint (เป็นงาน
  ของ classifier ก้อนถัดไป) — message_count นับจากจำนวน turn ที่เก็บได้จริง, status ตั้ง
  UNCLASSIFIED ไว้ก่อนเสมอ

*** ไม่บล็อก event loop ***
  record_turn() เป็น sync ล้วน (แค่ append list + set asyncio.Event) ไม่มี await เลย — งาน DB
  ทั้งหมด (insert ตอนปิด session) รันผ่าน run_in_executor เหมือน run_retrieval ใน routers/voice.py
  กันไม่ให้เสียงที่กำลังส่ง/เล่นอยู่สะดุดตอนเขียน DB

*** session ที่ไม่มี turn เลยไม่ถูกบันทึก ***
  ถ้า WS ต่อแล้วหลุดโดยไม่มีใครพูดอะไรเลย (ไม่มี speech_start/turn_complete แม้แต่ครั้งเดียว)
  จะไม่ insert แถวใน conversation_sessions — decision นี้แยกจากเรื่อง "session ขยะที่พูดแต่ไม่ถาม
  อะไรจริง" (นั่นต้องใช้ classifier ตัดสิน เป็นงานก้อนถัดไป ที่ mark SessionStatus.NOISE)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.config import settings
from app.database import SessionLocal
from app.models import ConversationSession, ConversationTurn
from app.models.enums import Language, SessionEndReason, SessionStatus, Speaker

logger = logging.getLogger("services.session_tracker")


def _insert_closed_session(
    ws_connection_id: str,
    turns: list[tuple[Speaker, datetime]],
    started_at: datetime,
    ended_at: datetime,
    end_reason: SessionEndReason,
) -> None:
    """sync — เรียกผ่าน loop.run_in_executor() เท่านั้น ห้ามเรียกตรงจาก event loop (blocking DB I/O)"""
    db = SessionLocal()
    try:
        db.add(
            ConversationSession(
                started_at=started_at,
                ended_at=ended_at,
                language=Language.TH,
                topic=None,
                tags=None,
                other_hint=None,
                message_count=len(turns),
                status=SessionStatus.UNCLASSIFIED,  # classifier (ก้อนถัดไป) จะอัปเดตทีหลัง
                end_reason=end_reason,
            )
        )
        db.add_all(
            ConversationTurn(ws_connection_id=ws_connection_id, speaker=speaker, occurred_at=occurred_at)
            for speaker, occurred_at in turns
        )
        db.commit()
    finally:
        db.close()


class SessionTracker:
    """หนึ่งอินสแตนซ์ต่อหนึ่ง WS connection — สร้างใน voice_ws() ทันทีหลัง accept()
    (ก่อน reconnect loop ของ Gemini) และ stop() ตอน voice_ws() จบไม่ว่าจะจบทางไหนก็ตาม"""

    def __init__(self, ws_connection_id: str, silence_timeout_s: float | None = None) -> None:
        self.ws_connection_id = ws_connection_id
        self._timeout_s = (
            silence_timeout_s if silence_timeout_s is not None else settings.BACKEND_SESSION_SILENCE_TIMEOUT_S
        )
        self._turns: list[tuple[Speaker, datetime]] = []
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
        started_at = self._session_started_at
        ended_at = turns[-1][1]
        self._turns = []
        self._session_started_at = None
        assert started_at is not None
        await loop.run_in_executor(
            None, _insert_closed_session, self.ws_connection_id, turns, started_at, ended_at, end_reason
        )

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
