"""
main.py — จุดเริ่มต้นของ FastAPI application

ตอนนี้ (Sprint 1) มีแค่:
  - GET /            : เช็กว่า API มีชีวิต
  - GET /health      : เช็กว่าเชื่อม DB ได้ไหม (ping database)
Endpoint จริง (chat, kb, dashboard) จะเพิ่มใน Sprint ถัด ๆ ไป ตาม API contract (T08)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.rag.embedding import get_embedder
from app.routers import auth, chat, documents

logger = logging.getLogger("main")


def _check_embedding_dim_matches_db() -> None:
    """
    เช็คตอน startup ว่ามิติของ embedder จริง (อ่านจากโมเดลที่โหลด ไม่ใช่เดาจาก .env) ตรงกับ
    คอลัมน์ vector ใน DB จริงไหม — กันปัญหาที่เจอมาแล้วตอนสลับจาก text-embedding-3-small (1536)
    เป็น e5-large (1024): ถ้าลืมรัน migration แล้วรันแอปไปเลย ระบบจะ error ตอนเขียน/ค้น vector
    แบบที่ error message งงมาก ไม่บอกตรง ๆ ว่ามิติไม่ตรง — เช็คแต่แรกแล้ว fail ทันทีชัดเจนกว่าเยอะ
    """
    embedder = get_embedder()
    with engine.connect() as conn:
        result = conn.execute(
            text(
                "SELECT atttypmod FROM pg_attribute "
                "WHERE attrelid = 'document_chunks'::regclass AND attname = 'embedding'"
            )
        ).scalar()
        db_dim = int(result) if result and result > 0 else None

    if db_dim is not None and db_dim != embedder.dim:
        raise RuntimeError(
            f"มิติของ embedding ไม่ตรงกัน! "
            f"embedder (EMBEDDING_PROVIDER={settings.EMBEDDING_PROVIDER!r}, "
            f"EMBEDDING_MODEL={settings.EMBEDDING_MODEL!r}) ให้ dim={embedder.dim} "
            f"แต่คอลัมน์ document_chunks.embedding ใน DB เป็น vector({db_dim}) — "
            f"ต้องรัน `alembic upgrade head` (ถ้ามี migration ปรับมิติค้างอยู่) "
            f"แล้ว reindex เอกสารทั้งหมดใหม่ก่อนเปลี่ยน EMBEDDING_PROVIDER/EMBEDDING_MODEL"
        )
    logger.info("embedding dim check ผ่าน: %s dim=%d ตรงกับ DB", settings.EMBEDDING_PROVIDER, embedder.dim)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # โค้ดตรงนี้รันตอน start ของแอป — เช็ค embedding dim ก่อนอย่างอื่น (fail เร็ว ดีกว่า fail ตอนมีคนถาม)
    _check_embedding_dim_matches_db()
    yield
    # โค้ดตรงนี้รันตอนปิดแอป
    engine.dispose()


app = FastAPI(
    title="DITC CAT API",
    description="ระบบ AI Chatbot Character DITC — Backend API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)


@app.get("/", tags=["meta"])
def root():
    return {
        "service": "DITC CAT API",
        "version": "0.1.0",
        "env": settings.APP_ENV,
        "docs": "/docs",
    }


@app.get("/health", tags=["meta"])
def health():
    """เช็กสุขภาพระบบ + ทดสอบเชื่อมต่อฐานข้อมูล"""
    db_ok = False
    detail = ""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        detail = str(exc)

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "detail": detail,
    }
