"""
indexer.py — สร้าง embedding ให้ Knowledge Base

ไหลงาน:  documents (เนื้อหาดิบจาก T03)  →  chunk  →  embed  →  document_chunks (มีเวกเตอร์)

ประหยัดการ embed (Scope 3.2):
    - index เฉพาะ document ที่ "ยังไม่มี chunk" (เพิ่ง scrape มาใหม่ หรือเนื้อหาเปลี่ยน
      ซึ่ง scraper จะล้าง chunk เดิมทิ้งให้แล้ว)
    - ใส่ reindex=True เพื่อบังคับสร้างใหม่ทั้งหมด (เช่นตอนเปลี่ยนโมเดล embedding)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.knowledge import Document, DocumentChunk
from app.rag.chunking import chunk_text
from app.rag.embedding import Embedder, get_embedder

logger = logging.getLogger("rag.indexer")


@dataclass
class IndexStats:
    documents_indexed: int = 0
    documents_skipped: int = 0
    chunks_created: int = 0

    def __str__(self) -> str:
        return (
            f"index {self.documents_indexed} doc | ข้าม {self.documents_skipped} | "
            f"สร้าง {self.chunks_created} chunk"
        )


def _documents_to_index(db: Session, reindex: bool) -> list[Document]:
    """เลือก document ที่ต้อง index: ถ้า reindex=เอาทั้งหมด, ไม่งั้นเอาเฉพาะที่ยังไม่มี chunk"""
    stmt = select(Document).where(Document.is_active.is_(True))
    if not reindex:
        # subquery: id ของ document ที่มี chunk อยู่แล้ว
        has_chunks = select(DocumentChunk.document_id).distinct().subquery()
        stmt = stmt.where(Document.id.not_in(select(has_chunks.c.document_id)))
    return list(db.scalars(stmt).all())


def index_documents(
    db: Session,
    embedder: Embedder | None = None,
    *,
    reindex: bool = False,
) -> IndexStats:
    """chunk + embed + เก็บ document_chunks ให้เอกสารที่ยังไม่ถูก index"""
    embedder = embedder or get_embedder()
    stats = IndexStats()

    if reindex:
        deleted = db.query(DocumentChunk).delete()
        logger.info("reindex: ล้าง chunk เดิม %d ชิ้น", deleted)

    documents = _documents_to_index(db, reindex)
    logger.info("จะ index ทั้งหมด %d document", len(documents))

    for doc in documents:
        chunks = chunk_text(doc.content)
        if not chunks:
            stats.documents_skipped += 1
            continue

        vectors = embedder.embed([c.content for c in chunks])
        for chunk, vector in zip(chunks, vectors):
            db.add(
                DocumentChunk(
                    document_id=doc.id,
                    chunk_index=chunk.index,
                    content=chunk.content,
                    token_count=chunk.token_count,
                    embedding=vector,
                )
            )
        stats.documents_indexed += 1
        stats.chunks_created += len(chunks)
        logger.info("  doc#%d '%s' → %d chunk", doc.id, (doc.title or "")[:40], len(chunks))

    db.commit()
    logger.info("index เสร็จ: %s", stats)
    return stats


def count_status(db: Session) -> tuple[int, int]:
    """คืน (จำนวน document, จำนวน chunk) ไว้แสดงสถานะ"""
    docs = db.scalar(select(func.count()).select_from(Document)) or 0
    chunks = db.scalar(select(func.count()).select_from(DocumentChunk)) or 0
    return docs, chunks
