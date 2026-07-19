"""
database.py — ตั้งค่าการเชื่อมต่อฐานข้อมูล (SQLAlchemy 2.0)

ส่วนประกอบ:
  - engine      : ตัวเชื่อมต่อ Postgres
  - SessionLocal: โรงงานสร้าง session (1 request = 1 session)
  - Base        : คลาสแม่ของทุก model (ตารางในฐานข้อมูล)
  - get_db()    : dependency ของ FastAPI สำหรับดึง session ต่อ 1 request
"""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from app.config import settings

# echo=True จะ log SQL ที่รันออกมา (ช่วยเรียนรู้ตอน dev), ปิดใน production
engine = create_engine(
    settings.database_url,
    echo=settings.APP_DEBUG,
    pool_pre_ping=True,  # เช็ก connection ก่อนใช้ กัน connection ตาย
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """คลาสแม่ของทุกตาราง — ทุก model จะ inherit จากตัวนี้"""
    pass


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency: ใช้แบบ  db: Session = Depends(get_db)
    เปิด session ตอนเริ่ม request แล้วปิดอัตโนมัติเมื่อจบ
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
