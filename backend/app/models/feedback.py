"""
feedback.py — เก็บผลสรุปฟีดแบคจากผู้ใช้ (Scope ข้อ 8)

PDPA: เก็บเฉพาะ "หัวข้อสรุป + หมวดหมู่ + โทน + วันเวลา" (Scope 8.5)
      ไม่เก็บเสียง/ข้อความดิบ เหมือนกับ ConversationSession
"""
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import FeedbackCategory, Language, Sentiment
from app.models.mixins import TimestampMixin


class Feedback(Base, TimestampMixin):
    __tablename__ = "feedbacks"

    id: Mapped[int] = mapped_column(primary_key=True)

    # ผูกกับ session ได้ (ถ้ามี) แต่ไม่บังคับ — ฟีดแบคเปิดได้อิสระ (Scope 8.2)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversation_sessions.id", ondelete="SET NULL")
    )

    category: Mapped[FeedbackCategory] = mapped_column(
        String(24), default=FeedbackCategory.OTHER, nullable=False
    )
    sentiment: Mapped[Sentiment] = mapped_column(
        String(12), default=Sentiment.NEUTRAL, nullable=False
    )

    # ข้อความที่ AI สรุปให้ (ไม่ใช่คำพูดดิบ) — Scope 8.4/8.5
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[Language] = mapped_column(String(4), default=Language.TH, nullable=False)
