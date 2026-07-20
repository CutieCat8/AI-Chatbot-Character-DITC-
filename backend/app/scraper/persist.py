"""
persist.py — บันทึกผล scrape ลงปลายทาง 2 แบบ

  1) dump_json()   → เขียนเป็นไฟล์ JSON (ใช้ทดสอบตอนยังไม่มี DB/Docker)
  2) save_to_db()  → upsert ลงตาราง documents (ใช้ตอน DB พร้อมแล้ว)

กติกา upsert (Scope 3.2):
  - ยังไม่มี url นี้        → เพิ่ม document ใหม่
  - มี url แต่ hash เปลี่ยน → อัปเดตเนื้อหา + ล้าง chunk เดิม (ต้อง re-embed ใน T04)
  - มี url และ hash เท่าเดิม → ข้าม (เนื้อหาไม่เปลี่ยน)
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.knowledge import Document
from app.scraper.models import ScrapedPage

logger = logging.getLogger("scraper.persist")


@dataclass
class SaveStats:
    """สรุปผลการบันทึกลง DB"""
    added: int = 0
    updated: int = 0
    unchanged: int = 0

    def __str__(self) -> str:
        return f"เพิ่มใหม่ {self.added} | อัปเดต {self.updated} | ไม่เปลี่ยน {self.unchanged}"


def dump_json(pages: list[ScrapedPage], path: str | Path) -> Path:
    """เขียนผล scrape เป็นไฟล์ JSON อ่านง่าย (ไม่ยุ่งกับ DB)"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = [p.to_json_dict() for p in pages]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("เขียน %d หน้า → %s", len(pages), path)
    return path


def save_to_db(pages: list[ScrapedPage], db: Session) -> SaveStats:
    """upsert รายการหน้าเว็บลงตาราง documents ตามกติกา hash ด้านบน"""
    stats = SaveStats()
    for page in pages:
        existing = db.scalar(
            select(Document).where(Document.source_url == page.source_url)
        )

        if existing is None:
            db.add(
                Document(
                    source_site=page.source_site,
                    source_url=page.source_url,
                    title=page.title,
                    content=page.content,
                    content_hash=page.content_hash,
                    language=page.language,
                    scraped_at=page.scraped_at,
                )
            )
            stats.added += 1
        elif existing.content_hash != page.content_hash:
            existing.title = page.title
            existing.content = page.content
            existing.content_hash = page.content_hash
            existing.language = page.language
            existing.scraped_at = page.scraped_at
            # เนื้อหาเปลี่ยน → chunk เดิมใช้ไม่ได้แล้ว ลบทิ้งรอ re-embed (T04)
            existing.chunks.clear()
            stats.updated += 1
        else:
            existing.scraped_at = page.scraped_at  # แตะเวลาไว้ว่าเพิ่งเช็ก
            stats.unchanged += 1

    db.commit()
    logger.info("บันทึกลง DB: %s", stats)
    return stats
