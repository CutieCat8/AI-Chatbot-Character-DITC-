"""
models.py — โครงสร้างข้อมูลกลางของ scraper (ไม่ใช่ตาราง DB)

ScrapedPage = ผลลัพธ์ของ 1 หน้าเว็บที่ดึงมาแล้ว "สะอาด" พร้อมบันทึก
ใช้ dataclass ธรรมดา ๆ เพื่อให้ทดสอบ/ดัมป์เป็น JSON ได้ง่าย โดยไม่ต้องพึ่ง DB
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from app.models.enums import Language, SourceSite


def compute_content_hash(text: str) -> str:
    """
    แฮชเนื้อหา (SHA-256) ไว้ตรวจว่าหน้าเว็บเปลี่ยนไปไหม
    ถ้า hash เท่าเดิม = เนื้อหาไม่เปลี่ยน → ไม่ต้อง re-embed ใหม่ (Scope 3.2)

    ทำ normalize เบา ๆ ก่อนแฮช (trim + รวมช่องว่าง) กันกรณีเว้นวรรคต่างเล็กน้อย
    แล้วทำให้ hash เด้งทั้งที่เนื้อหาจริงเหมือนเดิม
    """
    normalized = " ".join(text.split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def detect_language(text: str) -> Language:
    """
    เดาภาษาแบบง่าย: ถ้ามีตัวอักษรไทยเกิน 15% ของตัวอักษรทั้งหมด ถือว่าเป็นไทย
    (auto-detect ตาม Scope ข้อ 9 — ยังไม่ต้องแม่นมากในขั้น scrape)
    """
    thai = sum(1 for ch in text if "฀" <= ch <= "๿")
    letters = sum(1 for ch in text if ch.isalpha())
    if letters == 0:
        return Language.TH
    return Language.TH if thai / letters >= 0.15 else Language.EN


@dataclass
class ScrapedPage:
    """เนื้อหา 1 หน้าเว็บที่ดึง + ทำความสะอาดแล้ว (map ตรงกับตาราง documents)"""

    source_site: SourceSite
    source_url: str
    title: str | None
    content: str
    content_hash: str = ""
    language: Language = Language.TH
    scraped_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        # เติมค่าที่คำนวณได้เองอัตโนมัติ ถ้าผู้เรียกไม่ได้ส่งมา
        if not self.content_hash:
            self.content_hash = compute_content_hash(self.content)
        if self.language is None:
            self.language = detect_language(self.content)

    def to_json_dict(self) -> dict:
        """แปลงเป็น dict ที่ json.dumps ได้ (enum → str, datetime → ISO)"""
        d = asdict(self)
        d["source_site"] = self.source_site.value
        d["language"] = self.language.value
        d["scraped_at"] = self.scraped_at.isoformat()
        return d
