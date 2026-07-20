"""
run.py — สั่งรัน scraper จาก command line (T03)

ดึง 2 แหล่งตาม Scope 3.1:
    CAMT  → HTML scraper (www.camt.cmu.ac.th เป็น server-rendered)
    DITC  → Strapi API client (ditc.camt.cmu.ac.th เป็น SPA ดึง HTML ตรงไม่ได้)

ตัวอย่าง:
    # ดึงทั้งสองแหล่ง แล้ว dump JSON (ทดสอบได้แม้ยังไม่มี DB)
    python -m app.scraper.run --json data/scrape.json --max-pages 50

    # ดึงทั้งสองแหล่ง แล้ว dump JSON + บันทึกลง DB พร้อมกัน (ต้องมี DB + migration แล้ว)
    python -m app.scraper.run --json data/scrape.json --to-db

    # ดึงเฉพาะ DITC (Strapi) อย่างเดียว
    python -m app.scraper.run --only strapi --json data/ditc.json
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from app.config import settings
from app.scraper.crawler import Crawler
from app.scraper.fetcher import Fetcher
from app.scraper.models import ScrapedPage
from app.scraper.persist import dump_json, save_to_db
from app.scraper.strapi import scrape_strapi


def _html_seeds() -> list[str]:
    """seed ของ HTML scraper (CAMT) จาก SCRAPE_HTML_SEEDS ใน .env (คั่นด้วย ,)"""
    return [s.strip() for s in settings.SCRAPE_HTML_SEEDS.split(",") if s.strip()]


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="DITC/CAMT scraper (T03)")
    p.add_argument("--only", choices=["html", "strapi"],
                   help="ดึงเฉพาะแหล่งเดียว (ไม่ใส่ = ดึงทั้งสอง)")
    p.add_argument("--seed", action="append", dest="seeds",
                   help="override seed ของ HTML scraper (ใส่ซ้ำได้)")
    p.add_argument("--max-pages", type=int, default=100, help="จำนวนหน้าสูงสุดของ HTML scraper")
    p.add_argument("--max-depth", type=int, default=2, help="ความลึกการตามลิงก์ (HTML)")
    p.add_argument("--delay", type=float, default=1.0, help="หน่วงเวลา (วินาที) ต่อ request (HTML)")
    p.add_argument("--json", dest="json_path", help="เขียนผลรวมเป็นไฟล์ JSON")
    p.add_argument("--to-db", action="store_true", help="บันทึกลงตาราง documents")
    p.add_argument("--no-robots", action="store_true", help="ไม่สนใจ robots.txt (เฉพาะทดสอบ)")
    return p.parse_args()


async def _scrape_html(args: argparse.Namespace) -> list[ScrapedPage]:
    seeds = args.seeds or _html_seeds()
    logging.info("[HTML/CAMT] เริ่มจาก: %s", ", ".join(seeds))
    async with Fetcher(delay_seconds=args.delay, respect_robots=not args.no_robots) as fetcher:
        crawler = Crawler(
            seeds, max_depth=args.max_depth, max_pages=args.max_pages, fetcher=fetcher
        )
        return await crawler.crawl()


async def _gather(args: argparse.Namespace) -> list[ScrapedPage]:
    pages: list[ScrapedPage] = []
    if args.only != "strapi":
        pages += await _scrape_html(args)
    if args.only != "html":
        logging.info("[Strapi/DITC] เริ่มดึงจาก Strapi CMS")
        pages += await scrape_strapi()
    return pages


def main() -> None:
    # Windows console เริ่มต้นเป็น cp874 → log ภาษาไทยจะเพี้ยน; บังคับ stdout/stderr เป็น UTF-8
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = _parse_args()

    pages = asyncio.run(_gather(args))
    logging.info("ดึงได้ทั้งหมด %d หน้า", len(pages))
    if not pages:
        logging.warning("ไม่ได้เนื้อหาเลย — เช็ก seed / เน็ต / endpoint")

    if args.json_path:
        dump_json(pages, args.json_path)

    if args.to_db:
        from app.database import SessionLocal  # import ตรงนี้ กันบังคับต้องมี DB ตอนใช้ --json อย่างเดียว

        db = SessionLocal()
        try:
            stats = save_to_db(pages, db)
            logging.info("บันทึกลง DB เสร็จ: %s", stats)
        finally:
            db.close()

    if not args.json_path and not args.to_db:
        logging.info("ไม่ได้ระบุ --json หรือ --to-db → แสดงตัวอย่าง 3 หน้าแรก")
        for pg in pages[:3]:
            logging.info("• [%s] %s (%d ตัวอักษร)", pg.source_site.value, pg.title, len(pg.content))


if __name__ == "__main__":
    main()
