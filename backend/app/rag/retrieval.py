"""
retrieval.py — ค้นชิ้นเนื้อหา (chunk) ที่ใกล้เคียงคำถามที่สุด ด้วย pgvector

นี่คือ "retrieval เบื้องต้น" ของ T04 (พิสูจน์ว่า vector search ทำงาน)
ส่วน RAG pipeline เต็ม (guardrail + ส่งให้ LLM แต่งคำตอบ) เป็นงาน T10/T11 ใน Sprint 2

หลักการ: pgvector หา "ระยะ cosine" ระหว่างเวกเตอร์คำถามกับทุก chunk
         ระยะยิ่งน้อย = ยิ่งคล้าย → เรียงจากน้อยไปมาก เอา top_k
         (ใช้ index HNSW + vector_cosine_ops ที่สร้างไว้ตั้งแต่ T02)
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.enums import SourceSite
from app.models.knowledge import Document, DocumentChunk
from app.rag.embedding import Embedder, get_embedder


@dataclass
class RetrievedChunk:
    chunk_id: int
    document_id: int
    document_title: str | None
    source_url: str
    source_site: SourceSite
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
            Document.source_site,
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
            source_site=r.source_site,
            content=r.content,
            distance=float(r.distance),
        )
        for r in rows
    ]


_STOPWORDS = {
    "คือ", "อะไร", "ใน", "ที่", "และ", "หรือ", "ของ", "เป็น", "มี", "ไหม", "บ้าง",
    "ครับ", "คะ", "ค่ะ", "ได้", "จะ", "กับ", "ให้", "ไป", "มา", "นี้", "นั้น", "ๆ",
}


def _extract_keywords(query: str) -> list[str]:
    """ตัดคำถามเป็น token หยาบ ๆ (แยกด้วยช่องว่าง) ตัด stopword/คำสั้นเกินไปทิ้ง"""
    tokens = query.strip("?๏.,!ๆ ").split()
    return [t for t in tokens if len(t) >= 2 and t not in _STOPWORDS]


def keyword_search(
    db: Session,
    query: str,
    *,
    top_k: int = 5,
    keywords: list[str] | None = None,
    max_per_document: int | None = None,
) -> list[RetrievedChunk]:
    """
    ค้นแบบ ILIKE ตรงคำ (ไม่ใช่ semantic) — ใช้เสริม search() ตอน embedding ยังไม่ใช่ของจริง
    (EMBEDDING_PROVIDER=fake สร้างเวกเตอร์สุ่ม ค้นเชิงความหมายไม่ได้ผล) หรือใช้เป็น fallback
    ตอนคำถามมีคำเฉพาะ (ชื่อสาขา/ตัวย่อ) ที่ semantic search พลาดได้ง่าย

    หมายเหตุสำคัญ: ภาษาไทยไม่มีช่องว่างคั่นระหว่างคำ (ต่างจากอังกฤษ) การตัดคำแบบ
    split() ตรงๆ (_extract_keywords) จะได้ผลแค่กับประโยคที่บังเอิญมีช่องว่างคั่นคำ
    หรือคำทับศัพท์อังกฤษเท่านั้น — สำหรับคำถามแบบสนทนาให้ส่ง `keywords` ที่ผ่านการ
    ตัดคำอย่างถูกต้องมาก่อน (เช่น ให้ LLM ช่วยแตกคำ ดู app.llm.chat.expand_search_terms)
    """
    keywords = keywords if keywords is not None else _extract_keywords(query)
    if not keywords:
        return []

    conditions = [DocumentChunk.content.ilike(f"%{kw}%") for kw in keywords]
    stmt = (
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.content,
            Document.title,
            Document.source_url,
            Document.source_site,
        )
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.is_active.is_(True))
        .where(or_(*conditions))
        # ห้าม LIMIT ตรงนี้: query ไม่มี ORDER BY เลยได้แถวลำดับใดก็ได้จาก Postgres
        # ถ้า limit ไว้ก่อนจัดอันดับ (ด้านล่าง) เคยตัดเอกสารที่ตรงจริงทิ้งไปตั้งแต่ต้น
        # (เคสจริง: คำว่า "ซอฟต์แวร์" แมตช์หลายร้อย chunk, ตัดจนไม่เหลือ DII/MMIT)
        # จำนวน chunk ทั้งหมดยังเล็ก (หลักร้อย) การดึงมาให้ครบก่อนจัดอันดับใน Python จึงไม่แพง
    )

    # เนื้อหาถูกตัดเป็น chunk ละ ~800 ตัวอักษร แต่ละ fact มักโผล่แค่ chunk เดียว
    # ถ้าให้คะแนนแค่ "คำที่ตรงในแต่ละ chunk" หน้ารวมลิงก์ (เช่น หน้าลิสต์หลักสูตร ที่มีหลาย
    # คำเรียงกันในย่อหน้าเดียว) จะชนะหน้ารายละเอียดที่กระจายคำไปคนละ chunk เสมอ (บั๊กที่เจอจริง:
    # DII/MMIT มีแต่ละคำหลุดไปคนละ chunk เลยแพ้หน้าลิสต์ที่คำมากระจุกที่เดียว)
    # แก้โดยให้คะแนนระดับ "document" ก่อน (คำที่ตรง รวมทุก chunk ของเอกสารนั้น ไม่ซ้ำคำ)
    # แล้วค่อยเลือก chunk ตัวแทนจากเอกสารที่คะแนนสูงสุด
    matched_rows: list[tuple[set[str], object]] = []
    keyword_freq: dict[str, int] = dict.fromkeys(keywords, 0)
    for r in db.execute(stmt).all():
        matched = {kw for kw in keywords if kw.lower() in r.content.lower()}
        if not matched:
            continue
        for kw in matched:
            keyword_freq[kw] += 1
        matched_rows.append((matched, r))

    # ให้น้ำหนักคำหายากมากกว่าคำเกลื่อน (แนวคิดเดียวกับ IDF)
    # ทำไมต้องมี: การนับ "จำนวนคำที่ตรง" เฉย ๆ ทำให้คำที่โผล่ในทุก chunk ของเอกสารเดียวกัน
    # (เช่น "SE", "วิศวกรรมซอฟต์แวร์" ที่อยู่ในหัวทุกหน้าของหลักสูตรนั้น) มีน้ำหนักเท่ากับคำชี้เฉพาะ
    # อย่าง "ค่าธรรมเนียมการศึกษา" ที่มีแค่ 3 chunk จาก 373 — คะแนนจึงเสมอกันหมดแล้วไปตัดสินด้วย
    # ลำดับแถวที่ Postgres คืนมาซึ่งไม่แน่นอน
    # เคสจริงที่พัง: ถาม "ค่าเทอม SE เท่าไหร่" ได้ chunk ของ SE มาถูกเอกสาร แต่เป็นชิ้นรับสมัคร
    # ไม่ใช่ชิ้นที่มีตัวเลขค่าเทอม บอทเลยตอบว่าไม่มีข้อมูลทั้งที่อยู่ใน DB
    total = len(matched_rows) or 1
    weights = {kw: math.log(1 + total / (1 + freq)) for kw, freq in keyword_freq.items()}

    def _score(matched: set[str]) -> float:
        return sum(weights[kw] for kw in matched)

    doc_keyword_hits: dict[int, set[str]] = {}
    rows_by_doc: dict[int, list] = {}
    for matched, r in matched_rows:
        doc_keyword_hits.setdefault(r.document_id, set()).update(matched)
        rows_by_doc.setdefault(r.document_id, []).append((_score(matched), r))

    # จัดอันดับเอกสารด้วยคะแนนถ่วงน้ำหนักเช่นกัน — เอกสารที่โดนคำชี้เฉพาะควรมาก่อน
    # เอกสารที่โดนแต่คำกว้าง ๆ หลายคำ (ยังคงรวมคำจากทุก chunk ของเอกสารเหมือนเดิม)
    ranked_doc_ids = sorted(
        doc_keyword_hits,
        key=lambda doc_id: _score(doc_keyword_hits[doc_id]),
        reverse=True,
    )
    max_score = sum(weights.values()) or 1.0

    results: list[RetrievedChunk] = []
    for doc_id in ranked_doc_ids:
        if len(results) >= top_k:
            break
        doc_score = _score(doc_keyword_hits[doc_id]) / max_score
        # ในเอกสารเดียวกัน เอา chunk ที่คะแนนถ่วงน้ำหนักสูงสุดก่อน (ตัวแทนเนื้อหาที่ดีสุด)
        chunks = sorted(rows_by_doc[doc_id], key=lambda pair: pair[0], reverse=True)
        take = max_per_document if max_per_document is not None else len(chunks)
        for _, r in chunks[:take]:
            if len(results) >= top_k:
                break
            results.append(
                RetrievedChunk(
                    chunk_id=r.id,
                    document_id=r.document_id,
                    document_title=r.title,
                    source_url=r.source_url,
                    source_site=r.source_site,
                content=r.content,
                # ไม่ใช่ cosine distance จริง — แปลงจากคะแนนระดับ document เพื่อคง field เดิมไว้ใช้ร่วมกับ search()
                distance=1.0 - doc_score,
            )
        )
    return results
