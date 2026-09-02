"""
reindex_embeddings.py — สร้าง embedding ใหม่ทั้งหมดด้วย EMBEDDING_PROVIDER ปัจจุบัน

ใช้ตอนเปลี่ยน embedding model (ต้อง alembic upgrade head ให้มิติคอลัมน์ตรงก่อนเสมอ ไม่งั้น
main.py จะ fail ตอน startup อยู่ดีเพราะมี dim check) — ห่อ index_documents(reindex=True) เดิม

รัน: cd backend && .venv/Scripts/python -m app.scripts.reindex_embeddings
"""
from __future__ import annotations

import logging
import time

from app.database import SessionLocal
from app.rag.embedding import get_embedder
from app.rag.indexer import index_documents

logging.basicConfig(level=logging.INFO)


def main() -> None:
    embedder = get_embedder()
    print(f"ใช้ embedder: dim={embedder.dim}")

    db = SessionLocal()
    try:
        t0 = time.time()
        stats = index_documents(db, embedder=embedder, reindex=True)
        print(f"{stats} — ใช้เวลา {time.time() - t0:.1f}s")
    finally:
        db.close()


if __name__ == "__main__":
    main()
