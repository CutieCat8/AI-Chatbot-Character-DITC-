"""
schemas/document.py — Pydantic schema สำหรับ Knowledge Base API (T3x, admin dashboard)
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import Language, SourceSite


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_site: SourceSite
    source_url: str
    title: str | None
    language: Language
    is_active: bool
    scraped_at: datetime | None
    created_at: datetime
    updated_at: datetime
    chunk_count: int


class DocumentDetailOut(DocumentOut):
    """เหมือน DocumentOut แต่มี content เต็ม — ใช้ตอนกดดู/แก้ไขเอกสารเดียว"""

    content: str


class DocumentCreateIn(BaseModel):
    title: str | None = None
    content: str
    source_site: SourceSite = SourceSite.MANUAL
    source_url: str | None = None
    language: Language = Language.TH
    is_active: bool = True


class DocumentUpdateIn(BaseModel):
    """ทุก field เป็น optional — ส่งมาเฉพาะอันที่จะแก้ (partial update)"""

    title: str | None = None
    content: str | None = None
    is_active: bool | None = None
    language: Language | None = None


class DocumentListOut(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    page_size: int


class SourceStatOut(BaseModel):
    source_site: SourceSite
    count: int


class DocumentStatsOut(BaseModel):
    total: int
    by_source: list[SourceStatOut]


class SyncStatusOut(BaseModel):
    is_running: bool
    today_count: int
    last_synced_at: datetime | None
    needs_attention_count: int


class SyncTriggerOut(BaseModel):
    started: bool
    message: str
