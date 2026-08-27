"""
routers/documents.py — Knowledge Base API สำหรับ frontend-admin (list/stats/sync + CRUD)

หมายเหตุ: เพิ่ม/แก้/ลบเอกสาร (Scope 6.2) ยังไม่มี auth คุ้มกัน (T27 ยังไม่ทำ)
เปิดให้ใช้ได้เลยตอนนี้เพราะเป็นแดชบอร์ด demo ภายใน ไม่มีผู้ใช้จริงเข้าถึง —
ต้องเพิ่ม auth ก่อน deploy จริง
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.enums import SourceSite
from app.models.knowledge import Document, DocumentChunk
from app.rag.embedding import get_embedder
from app.rag.indexer import index_one_document
from app.schemas.document import (
    DocumentCreateIn,
    DocumentDetailOut,
    DocumentListOut,
    DocumentOut,
    DocumentStatsOut,
    DocumentUpdateIn,
    SourceStatOut,
    SyncStatusOut,
    SyncTriggerOut,
)
from app.scraper.models import compute_content_hash
from app.scraper.sync_service import is_sync_running, run_sync

router = APIRouter(prefix="/api/documents", tags=["knowledge-base"])


@router.get("", response_model=DocumentListOut)
def list_documents(
    db: Session = Depends(get_db),
    source: SourceSite | None = None,
    is_active: bool | None = None,
    search: str | None = Query(None, min_length=1, max_length=200),
    unindexed: bool | None = Query(None, description="True = เอาเฉพาะเอกสารที่ยังไม่มี chunk (ยังไม่ถูก index)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> DocumentListOut:
    chunk_count = (
        select(func.count(DocumentChunk.id))
        .where(DocumentChunk.document_id == Document.id)
        .correlate(Document)
        .scalar_subquery()
    )

    stmt = select(Document, chunk_count.label("chunk_count"))

    if source is not None:
        stmt = stmt.where(Document.source_site == source)
    if is_active is not None:
        stmt = stmt.where(Document.is_active == is_active)
    if search:
        # ค้นแบบ AND ทีละคำ (แยกด้วยช่องว่าง) ไม่ใช่ match ทั้งวลีเป๊ะ ๆ
        # เพราะคำค้นหลายคำ (เช่น "หลักสูตร ANI") มักไม่ได้เรียงติดกันเป๊ะในเนื้อหาจริง
        terms = [t for t in search.split() if t]
        for term in terms:
            like = f"%{term}%"
            stmt = stmt.where(or_(Document.title.ilike(like), Document.content.ilike(like)))
    if unindexed:
        has_chunks = select(DocumentChunk.document_id).distinct().subquery()
        stmt = stmt.where(Document.id.not_in(select(has_chunks.c.document_id)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    stmt = (
        stmt.order_by(Document.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = db.execute(stmt).all()
    items = [
        DocumentOut.model_validate({**doc.__dict__, "chunk_count": count})
        for doc, count in rows
    ]

    return DocumentListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=DocumentStatsOut)
def document_stats(db: Session = Depends(get_db)) -> DocumentStatsOut:
    rows = db.execute(
        select(Document.source_site, func.count(Document.id)).group_by(Document.source_site)
    ).all()
    total = sum(count for _, count in rows)
    return DocumentStatsOut(
        total=total,
        by_source=[SourceStatOut(source_site=src, count=count) for src, count in rows],
    )


@router.get("/sync-status", response_model=SyncStatusOut)
def sync_status(db: Session = Depends(get_db)) -> SyncStatusOut:
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = (
        db.scalar(select(func.count()).select_from(Document).where(Document.created_at >= today_start))
        or 0
    )
    last_synced_at = db.scalar(select(func.max(Document.scraped_at)))

    # ยังไม่ถูก index (ไม่มี chunk เลย) → ยังค้นหาไม่เจอ ต้องดูแล
    has_chunks = select(DocumentChunk.document_id).distinct().subquery()
    needs_attention_count = (
        db.scalar(
            select(func.count())
            .select_from(Document)
            .where(Document.id.not_in(select(has_chunks.c.document_id)))
        )
        or 0
    )

    return SyncStatusOut(
        is_running=is_sync_running(),
        today_count=today_count,
        last_synced_at=last_synced_at,
        needs_attention_count=needs_attention_count,
    )


@router.post("/sync", response_model=SyncTriggerOut)
def trigger_sync(background_tasks: BackgroundTasks) -> SyncTriggerOut:
    if is_sync_running():
        return SyncTriggerOut(started=False, message="Sync กำลังรันอยู่แล้ว")

    background_tasks.add_task(run_sync)
    return SyncTriggerOut(started=True, message="เริ่ม sync แล้ว (รันเบื้องหลัง)")


def _get_document_or_404(db: Session, document_id: int) -> Document:
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="ไม่พบเอกสารนี้")
    return doc


def _chunk_count(db: Session, document_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(DocumentChunk).where(DocumentChunk.document_id == document_id)
    ) or 0


@router.get("/{document_id}", response_model=DocumentDetailOut)
def get_document(document_id: int, db: Session = Depends(get_db)) -> DocumentDetailOut:
    doc = _get_document_or_404(db, document_id)
    return DocumentDetailOut.model_validate({**doc.__dict__, "chunk_count": _chunk_count(db, document_id)})


@router.post("", response_model=DocumentDetailOut, status_code=201)
def create_document(payload: DocumentCreateIn, db: Session = Depends(get_db)) -> DocumentDetailOut:
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="content ห้ามว่าง")

    doc = Document(
        source_site=payload.source_site,
        # แอดมินพิมพ์เองไม่มี URL จริง — ใส่ placeholder ที่ไม่ชนกัน (คอลัมน์นี้ unique + NOT NULL)
        source_url=payload.source_url or f"manual://{uuid.uuid4()}",
        title=payload.title,
        content=content,
        content_hash=compute_content_hash(content),
        language=payload.language,
        is_active=payload.is_active,
    )
    db.add(doc)
    db.flush()  # เอา doc.id มาใช้ index ต่อโดยยังไม่ commit

    chunk_count = index_one_document(db, doc, get_embedder())
    db.commit()
    db.refresh(doc)

    return DocumentDetailOut.model_validate({**doc.__dict__, "chunk_count": chunk_count})


@router.patch("/{document_id}", response_model=DocumentDetailOut)
def update_document(document_id: int, payload: DocumentUpdateIn, db: Session = Depends(get_db)) -> DocumentDetailOut:
    doc = _get_document_or_404(db, document_id)

    content_changed = False
    if payload.title is not None:
        doc.title = payload.title
    if payload.is_active is not None:
        doc.is_active = payload.is_active
    if payload.language is not None:
        doc.language = payload.language
    if payload.content is not None:
        content = payload.content.strip()
        if not content:
            raise HTTPException(status_code=422, detail="content ห้ามว่าง")
        doc.content = content
        doc.content_hash = compute_content_hash(content)
        content_changed = True

    # เนื้อหาเปลี่ยน → chunk เดิมใช้ไม่ได้แล้ว ต้อง re-index ใหม่ทันที (ไม่รอ Sync Now รอบหน้า)
    chunk_count = index_one_document(db, doc, get_embedder()) if content_changed else _chunk_count(db, document_id)

    db.commit()
    db.refresh(doc)

    return DocumentDetailOut.model_validate({**doc.__dict__, "chunk_count": chunk_count})


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: int, db: Session = Depends(get_db)) -> None:
    doc = _get_document_or_404(db, document_id)
    db.delete(doc)  # chunks หายตามด้วย (ondelete=CASCADE)
    db.commit()
