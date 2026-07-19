"""
mixins.py — ชิ้นส่วนที่ใช้ซ้ำในหลายตาราง
TimestampMixin: เพิ่มคอลัมน์ created_at / updated_at ให้อัตโนมัติ
"""
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
