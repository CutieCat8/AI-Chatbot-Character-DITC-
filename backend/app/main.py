"""
main.py — จุดเริ่มต้นของ FastAPI application

ตอนนี้ (Sprint 1) มีแค่:
  - GET /            : เช็กว่า API มีชีวิต
  - GET /health      : เช็กว่าเชื่อม DB ได้ไหม (ping database)
Endpoint จริง (chat, kb, dashboard) จะเพิ่มใน Sprint ถัด ๆ ไป ตาม API contract (T08)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.routers import auth, chat, documents


@asynccontextmanager
async def lifespan(app: FastAPI):
    # โค้ดตรงนี้รันตอน start ของแอป (เผื่อใช้ต่อในอนาคต เช่น warm-up)
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
