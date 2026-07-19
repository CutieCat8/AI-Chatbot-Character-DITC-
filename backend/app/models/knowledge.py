"""
knowledge.py — ตารางฐานความรู้ (Knowledge Base) สำหรับ RAG

แนวคิด:
  Document  = เนื้อหา 1 หน้า/บทความ ที่ scrape มา (Scope 3.1) หรือแอดมินเพิ่มเอง (Scope 6.2)
  DocumentChunk = ตัด Document เป็นชิ้นเล็ก ๆ + เก็บ embedding (vector) เพื่อค้นเชิงความหมาย (Scope 3.3)

ทำไมต้องแยกเป็น chunk?
  โมเดล embedding รับข้อความได้จำกัด และการค้นแบบ semantic แม่นกว่าเมื่อเนื้อหาเป็นชิ้นย่อย
"""
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base
from app.models.enums import Language, SourceSite
from app.models.mixins import TimestampMixin


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)

    source_site: Mapped[SourceSite] = mapped_column(String(16), nullable=False)
    source_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    title: Mapped[str | None] = mapped_column(String(512))
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # ใช้ตรวจว่าหน้าเว็บเปลี่ยนไหม (จะได้ไม่ต้อง re-embed ถ้าเนื้อหาเหมือนเดิม) — Scope 3.2
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    language: Mapped[Language] = mapped_column(String(4), default=Language.TH, nullable=False)

    # แอดมินซ่อน/ปิดใช้แหล่งข้อมูลได้ (Scope 6.2)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # 1 document มีได้หลาย chunk; ลบ document แล้ว chunk หายตาม
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # กัน scrape url ซ้ำ
        UniqueConstraint("source_url", name="uq_documents_source_url"),
    )


class DocumentChunk(Base, TimestampMixin):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)  # ลำดับชิ้นใน document
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer)

    # หัวใจของ RAG: เวกเตอร์สำหรับ semantic search
    # มิติ (dim) มาจาก settings.EMBEDDING_DIM — ถ้าเปลี่ยน provider ต้องทำ migration ใหม่
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.EMBEDDING_DIM))

    document: Mapped["Document"] = relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_chunk_doc_index"),
        # index สำหรับค้น vector แบบ cosine distance (HNSW เร็วสำหรับ ANN search)
        Index(
            "ix_document_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
