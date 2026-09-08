"""
conversation_turn.py — timestamp ดิบของแต่ละ turn การพูด (PDPA-safe: ไม่มีข้อความใด ๆ)

*** ทำไมแยกจาก ConversationSession ***
  ConversationSession คือหน่วย "analytics session" ที่ตัดจากเกณฑ์เงียบต่อเนื่อง (ตอนนี้ 60 วิ
  ดู Settings.BACKEND_SESSION_SILENCE_TIMEOUT_S) — เกณฑ์นี้เปลี่ยนได้ในอนาคต (เช่น พอมี wake word
  แล้วจะเปลี่ยนวิธีตัดขอบเขตทั้งหมด) ถ้าผูก session_id ไว้กับ turn ตั้งแต่ตอนบันทึก จะ regroup
  ย้อนหลังไม่ได้เพราะขอบเขตถูก bake ไปแล้ว

  ตารางนี้จึงผูกกับ ws_connection_id (สร้างครั้งเดียวตอน WS accept() — "ตู้เปิดใช้งานครั้งนี้")
  แทน ไม่ผูกกับ session — การตัดกลุ่มเป็น session ทำเป็น query/batch job ทีหลังได้เสมอ ใช้เกณฑ์
  ปัจจุบันเทียบ occurred_at เอา ไม่ต้องมีข้อความเก็บอยู่เลยตั้งแต่ต้น (privacy เท่าเดิมไม่ว่าจะ
  regroup กี่รอบ) ดูรายละเอียดที่คุยกันไว้ในบทสนทนาออกแบบ session tracker (2026-09-08)
"""
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import Speaker
from app.models.mixins import TimestampMixin


class ConversationTurn(Base, TimestampMixin):
    __tablename__ = "conversation_turns"

    id: Mapped[int] = mapped_column(primary_key=True)

    # uuid4 string สร้างตอน accept() ใน routers/voice.py — ไม่ใช้ postgres UUID type เพราะ
    # โปรเจกต์นี้ยังไม่มี pattern นี้ที่ไหนเลย เก็บเป็น string เหมือนคอลัมน์อื่น ๆ ทั้งหมด
    ws_connection_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    speaker: Mapped[Speaker] = mapped_column(String(8), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
