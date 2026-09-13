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

# เดิมผูก echo กับ APP_DEBUG ตรงๆ — ปิดแล้ว (2026-09-14 เจ้าของงานสั่ง) เพราะ APP_DEBUG=true ปกติตอน
# dev ทำให้ SQL log ท่วม console จนอ่าน log อื่นที่ต้องการจริงๆ (เช่น [greet_diag]/[input_stt_diag]
# ใน routers/voice.py) ไม่ออกเลย ถ้าอยากดู SQL อีกทีให้เปิด echo=True ตรงนี้ชั่วคราวเฉพาะตอนต้องการจริง
engine = create_engine(
    settings.database_url,
    echo=False,
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
