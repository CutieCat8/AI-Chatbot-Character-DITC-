"""
verify.py — พิสูจน์ว่า Vector Database ทำงานครบวงจร (ดีลิเวอรีหลักของ T04)

รันหลัง `docker compose up` + `alembic upgrade head` แล้ว:
    python -m app.rag.verify                 # เช็ก pgvector + index + ค้นตัวอย่าง
    python -m app.rag.verify --seed-demo     # ใส่ข้อมูลตัวอย่าง (เผื่อยังไม่ได้ scrape จริง)
    python -m app.rag.verify --query "ค่าเทอมเท่าไหร่"   # ลองค้นคำถามเอง
    python -m app.rag.verify --reindex       # สร้าง embedding ใหม่ทั้งหมด

ทดสอบแบบไม่ต้องมี OpenAI key ได้ด้วย EMBEDDING_PROVIDER=fake (พิสูจน์ "ท่อ" อย่างเดียว)
"""
from __future__ import annotations

import argparse
import logging
import sys

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.models.enums import Language, SourceSite
from app.models.knowledge import Document
from app.rag.embedding import get_embedder
from app.rag.indexer import count_status, index_documents
from app.rag.retrieval import search

logger = logging.getLogger("rag.verify")

# คำถามตัวอย่างไว้ทดสอบการค้น (ครอบคลุมเรื่อง CAMT/DITC)
DEMO_QUERIES = [
    "หลักสูตรที่เปิดสอนมีอะไรบ้าง",
    "ห้องแลบมีอุปกรณ์อะไร ราคาเท่าไหร่",
    "มีข่าวหรือกิจกรรมอะไรล่าสุด",
]

# ข้อมูลตัวอย่าง (ใช้กับ --seed-demo เมื่อยังไม่มีข้อมูล scrape จริง)
DEMO_DOCS = [
    ("หลักสูตรวิศวกรรมซอฟต์แวร์ (SE)",
     "คณะ CAMT เปิดสอนหลักสูตรวิศวกรรมซอฟต์แวร์ (Software Engineering) "
     "เน้นการพัฒนาระบบซอฟต์แวร์ การจัดการโครงการ และเทคโนโลยีสมัยใหม่"),
    ("ห้องปฏิบัติการ Motion Capture",
     "ศูนย์ DITC มีห้องแลบ Motion Capture พร้อมชุดอุปกรณ์ Rokoko "
     "ให้นักศึกษาจองใช้งานได้ ราคาเริ่มต้น 200 บาทต่อชั่วโมง ติดต่อเจ้าหน้าที่ศูนย์"),
    ("ข่าวกิจกรรม Pitching Day Webtoon",
     "ศูนย์ DITC จัดกิจกรรม Pitching Day Webtoon Academy คัดเลือกทีมผลงานเว็บตูนเด่น "
     "ร่วมกับภาคอุตสาหกรรม เพื่อส่งเสริม Creative Content Creator"),
]


def check_pgvector(db) -> bool:
    """ตรวจว่า extension 'vector' (pgvector) ถูกเปิดใน DB แล้วหรือยัง"""
    row = db.execute(
        text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    ).first()
    if row:
        logger.info("✓ pgvector พร้อมใช้ (version %s)", row[0])
        return True
    logger.error("✗ ยังไม่ได้เปิด extension 'vector' — เช็ก db/init และรัน migration")
    return False


def seed_demo(db) -> None:
    """ใส่ document ตัวอย่างถ้ายังไม่มี (idempotent — รันซ้ำได้ ไม่ซ้ำข้อมูล)"""
    added = 0
    for i, (title, content) in enumerate(DEMO_DOCS):
        url = f"{settings.DITC_SITE_BASE.rstrip('/')}/_demo/{i}"
        exists = db.query(Document).filter(Document.source_url == url).first()
        if exists:
            continue
        db.add(Document(
            source_site=SourceSite.DITC, source_url=url, title=title,
            content=content, content_hash=f"demo-{i}", language=Language.TH,
        ))
        added += 1
    db.commit()
    logger.info("seed-demo: เพิ่มข้อมูลตัวอย่าง %d รายการ", added)


def _print_results(query: str, results) -> None:
    print(f"\n🔎 คำถาม: {query}")
    if not results:
        print("   (ไม่พบผลลัพธ์ — Knowledge Base อาจว่าง)")
        return
    for rank, r in enumerate(results, 1):
        preview = r.content.replace("\n", " ")[:90]
        print(f"   {rank}. sim={r.similarity:.3f} | {r.document_title or '-'}")
        print(f"      {preview}...")


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    parser = argparse.ArgumentParser(description="ตรวจสอบ Vector Database (T04)")
    parser.add_argument("--seed-demo", action="store_true", help="ใส่ข้อมูลตัวอย่างก่อนทดสอบ")
    parser.add_argument("--reindex", action="store_true", help="สร้าง embedding ใหม่ทั้งหมด")
    parser.add_argument("--query", help="คำถามที่อยากลองค้น (ไม่ใส่ = ใช้ชุดตัวอย่าง)")
    parser.add_argument("--top-k", type=int, default=5, help="จำนวนผลลัพธ์ต่อคำถาม")
    args = parser.parse_args()

    logger.info("EMBEDDING_PROVIDER=%s | dim=%d", settings.EMBEDDING_PROVIDER, settings.EMBEDDING_DIM)

    db = SessionLocal()
    try:
        if not check_pgvector(db):
            sys.exit(1)

        if args.seed_demo:
            seed_demo(db)

        docs, chunks = count_status(db)
        logger.info("สถานะก่อน index: %d document, %d chunk", docs, chunks)
        if docs == 0:
            logger.warning("ยังไม่มี document — รัน scraper (T03) ก่อน หรือใช้ --seed-demo")
            return

        embedder = get_embedder()  # อาจ error ถ้าเลือก openai แต่ไม่มี key → บอกชัดใน embedding.py
        index_documents(db, embedder, reindex=args.reindex)

        docs, chunks = count_status(db)
        logger.info("สถานะหลัง index: %d document, %d chunk", docs, chunks)

        queries = [args.query] if args.query else DEMO_QUERIES
        for q in queries:
            _print_results(q, search(db, q, top_k=args.top_k, embedder=embedder))

        print("\n✓ T04 ผ่าน: pgvector + embedding + retrieval ทำงานครบวงจร")
    finally:
        db.close()


if __name__ == "__main__":
    main()
