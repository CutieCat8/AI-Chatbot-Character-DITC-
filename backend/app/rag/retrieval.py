"""
retrieval.py — ค้นชิ้นเนื้อหา (chunk) ที่ใกล้เคียงคำถามที่สุด ด้วย pgvector

นี่คือ "retrieval เบื้องต้น" ของ T04 (พิสูจน์ว่า vector search ทำงาน)
ส่วน RAG pipeline เต็ม (guardrail + ส่งให้ LLM แต่งคำตอบ) เป็นงาน T10/T11 ใน Sprint 2

หลักการ: pgvector หา "ระยะ cosine" ระหว่างเวกเตอร์คำถามกับทุก chunk
         ระยะยิ่งน้อย = ยิ่งคล้าย → เรียงจากน้อยไปมาก เอา top_k
         (ใช้ index HNSW + vector_cosine_ops ที่สร้างไว้ตั้งแต่ T02)
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.knowledge import Document, DocumentChunk
from app.rag.embedding import Embedder, get_embedder


@dataclass
class RetrievedChunk:
    chunk_id: int
    document_id: int
    document_title: str | None
    source_url: str
    content: str
    distance: float          # cosine distance (0 = เหมือนกันเป๊ะ, ยิ่งมากยิ่งต่าง)

    @property
    def similarity(self) -> float:
        """แปลงเป็นคะแนนความคล้าย 0–1 อ่านง่าย (1 = เหมือนที่สุด)"""
        return 1.0 - self.distance


def search(
    db: Session,
    query: str,
    *,
    top_k: int = 5,
    embedder: Embedder | None = None,
) -> list[RetrievedChunk]:
    """embed คำถาม แล้วคืน chunk ที่ใกล้ที่สุด top_k อัน (พร้อมข้อมูล document ต้นทาง)"""
    embedder = embedder or get_embedder()
    query_vector = embedder.embed_one(query)

    # .cosine_distance() มาจาก pgvector.sqlalchemy — แปลเป็น operator <=> ใน SQL
    distance = DocumentChunk.embedding.cosine_distance(query_vector).label("distance")

    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.content,
            Document.title,
            Document.source_url,
            distance,
        )
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.is_active.is_(True))
        .order_by(distance)      # ระยะน้อยสุดก่อน = คล้ายสุด
        .limit(top_k)
    )

    rows = db.execute(stmt).all()
    return [
        RetrievedChunk(
            chunk_id=r.id,
            document_id=r.document_id,
            document_title=r.title,
            source_url=r.source_url,
            content=r.content,
            distance=float(r.distance),
        )
        for r in rows
    ]
