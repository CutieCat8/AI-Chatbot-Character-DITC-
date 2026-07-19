"""
idle_content.py — ข่าว/ประกาศที่วนแสดงในโหมด Idle/Sleep (Scope ข้อ 5)

ระบบดึงข่าวจากเว็บ DITC มาแสดงเอง (Scope 5.1, 5.2)
แอดมิน toggle ซ่อน/แสดงบางรายการได้ (Scope 5.3, 6.5)
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import Language
from app.models.mixins import TimestampMixin


class IdleContent(Base, TimestampMixin):
    __tablename__ = "idle_contents"

    id: Mapped[int] = mapped_column(primary_key=True)

    source_url: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(1024))
    language: Mapped[Language] = mapped_column(String(4), default=Language.TH, nullable=False)

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # แอดมินซ่อนรายการนี้ไม่ให้ขึ้นจอ (Scope 5.3)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # ลำดับการแสดง (ยิ่งน้อยยิ่งขึ้นก่อน) — ระบบจัดเองได้ (Scope 5.2) แต่เผื่อปรับ
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
