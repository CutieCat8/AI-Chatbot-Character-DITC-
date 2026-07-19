"""
admin.py — ผู้ดูแลระบบ สำหรับล็อกอินเข้าเว็บจัดการ (Scope 6.1, ใช้เต็มตอน T27)
เก็บเฉพาะรหัสผ่านที่ hash แล้ว (ห้ามเก็บ plain text)
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.enums import AdminRole
from app.models.mixins import TimestampMixin


class AdminUser(Base, TimestampMixin):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(128))

    role: Mapped[AdminRole] = mapped_column(String(16), default=AdminRole.ADMIN, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
