"""
sync_service.py — เรียก scrape + index ให้ admin dashboard กดสั่งเองได้ (ปุ่ม "Sync Now")

ใช้ FastAPI BackgroundTasks เรียก: crawl (T03) → upsert DB (T03) → chunk+embed (T04)
เก็บ state ไว้ในหน่วยความจำแค่ "กำลังรันอยู่ไหม" (ไม่ต้องคงอยู่ข้าม restart)
"""
from __future__ import annotations

import logging

from app.config import settings
from app.database import SessionLocal
from app.rag.embedding import get_embedder
from app.rag.indexer import index_documents
from app.scraper.crawler import Crawler
from app.scraper.fetcher import Fetcher
from app.scraper.persist import save_to_db
from app.scraper.strapi import scrape_strapi

logger = logging.getLogger("scraper.sync_service")

_sync_in_progress = False


def is_sync_running() -> bool:
    return _sync_in_progress


async def run_sync(*, max_pages: int = 60, delay_seconds: float = 1.0) -> None:
    """ดึงเว็บ CAMT + DITC ใหม่ → upsert ลง DB → index เอกสารที่ยังไม่มี chunk"""
    global _sync_in_progress
    if _sync_in_progress:
        logger.info("sync กำลังรันอยู่แล้ว — ข้ามรอบนี้")
        return

    _sync_in_progress = True
    try:
        seeds = [s.strip() for s in settings.SCRAPE_HTML_SEEDS.split(",") if s.strip()]

        async with Fetcher(delay_seconds=delay_seconds, respect_robots=True) as fetcher:
            crawler = Crawler(seeds, max_depth=2, max_pages=max_pages, fetcher=fetcher)
            pages = await crawler.crawl()
        pages += await scrape_strapi()

        logger.info("[sync] ดึงได้ %d หน้า", len(pages))

        db = SessionLocal()
        try:
            save_stats = save_to_db(pages, db)
            index_stats = index_documents(db, get_embedder(), reindex=False)
            logger.info("[sync] เสร็จ: %s | %s", save_stats, index_stats)
        finally:
            db.close()
    except Exception:
        logger.exception("[sync] ล้มเหลว")
    finally:
        _sync_in_progress = False
