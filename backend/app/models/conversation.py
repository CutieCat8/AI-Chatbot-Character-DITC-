"""
conversation.py — บันทึกสถิติบทสนทนา (PDPA-safe)

*** สำคัญมาก (Scope ข้อ 7 + PDPA) ***
  ห้ามเก็บบทสนทนาหรือเสียงดิบทั้งหมด!
  เก็บเฉพาะ "หัวข้อสรุป" ที่ AI ย่อให้ + แท็ก + วันเวลา + ผลลัพธ์
  เพื่อนำไปทำสถิติในแดชบอร์ด (Scope 6.3) โดยไม่เสี่ยงข้อมูลส่วนบุคคล
"""
from datetime import datetime

from sqlalchemy import ARRAY, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import Language, SessionEndReason, SessionStatus
from app.models.mixins import TimestampMixin


class ConversationSession(Base, TimestampMixin):
    __tablename__ = "conversation_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    language: Mapped[Language] = mapped_column(String(4), default=Language.TH, nullable=False)

    # หัวข้อที่ AI สรุปว่าถามเรื่องอะไร (Scope 7.2) — ไม่ใช่บทสนทนาเต็ม
    topic: Mapped[str | None] = mapped_column(String(255))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(String(64)))  # แท็กสั้น ๆ



    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    status: Mapped[SessionStatus] = mapped_column(
        String(20), default=SessionStatus.ANSWERED, nullable=False
    )
    end_reason: Mapped[SessionEndReason] = mapped_column(
        String(20), default=SessionEndReason.UNKNOWN, nullable=False
    )
