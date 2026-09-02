"""
retrieval.py — ค้นชิ้นเนื้อหา (chunk) ที่ใกล้เคียงคำถามที่สุด ด้วย pgvector

นี่คือ "retrieval เบื้องต้น" ของ T04 (พิสูจน์ว่า vector search ทำงาน)
ส่วน RAG pipeline เต็ม (guardrail + ส่งให้ LLM แต่งคำตอบ) เป็นงาน T10/T11 ใน Sprint 2

หลักการ: pgvector หา "ระยะ cosine" ระหว่างเวกเตอร์คำถามกับทุก chunk
         ระยะยิ่งน้อย = ยิ่งคล้าย → เรียงจากน้อยไปมาก เอา top_k
         (ใช้ index HNSW + vector_cosine_ops ที่สร้างไว้ตั้งแต่ T02)
"""
from __future__ import annotations

import re
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


# คำที่ STT มักถอดเสียง "DITC" ผิด (ทดสอบจริงกับ Gemini Live เจอ "DITC" -> "ITC" หาย D ตัวแรก)
# normalize ก่อนเข้า retrieval ทุกทาง (keyword + vector) กันคำถามเกี่ยวกับศูนย์ DITC หลุด
_DITC_ALIASES = ("ดิติซี", "ดีไอทีซี", "ดีติซี", "ดิทซี")
# หมายเหตุ: "ดิจิทัล" (digital เฉย ๆ) ไม่ใส่เป็น alias ตรงนี้ — เป็นคำทั่วไปที่ขึ้นในหลายบริบทจริง
# (เกมดิจิทัล, เทคโนโลยีดิจิทัล ฯลฯ) ถ้า map เป็น DITC เหมารวมจะเกิด false positive เยอะ
# (เช่น "อยากเรียนเกมดิจิทัล" จะเพี้ยนเป็นถามเรื่องศูนย์ DITC ไปเลย) ถ้าเจอเคสจริงที่ต้องแก้ค่อยกลับมาคุยกัน


def normalize_query(query: str) -> str:
    """แก้คำที่ STT มักถอดเสียงผิด/เพี้ยนให้เป็นคำที่ตรงกับที่ใช้จริงในฐานความรู้"""
    normalized = query
    for alias in _DITC_ALIASES:
        normalized = normalized.replace(alias, "DITC")
    # "ITC" โดด ๆ (ไม่ใช่ในคำอังกฤษอื่นที่บังเอิญมี itc อยู่ข้างใน เช่น "stitch") มักเป็น "DITC" ที่หาย D
    # หมายเหตุ: เช็คแค่ฝั่งตัวอักษรละติน ไม่เช็คฝั่งอักษรไทย เพราะภาษาไทยไม่มีช่องว่างคั่นคำ
    # ("ITCตั้งอยู่ที่ไหน" ก็ต้องจับได้ — เจอบั๊กนี้จริงตอนทดสอบ)
    if re.search(r"(?<![A-Za-z])ITC(?![A-Za-z])", normalized) and "DITC" not in normalized:
        normalized = re.sub(r"(?<![A-Za-z])ITC(?![A-Za-z])", "DITC", normalized)
    return normalized


def search(
    db: Session,
    query: str,
    *,
    top_k: int = 5,
    embedder: Embedder | None = None,
) -> list[RetrievedChunk]:
    """embed คำถาม แล้วคืน chunk ที่ใกล้ที่สุด top_k อัน (พร้อมข้อมูล document ต้นทาง)"""
    query = normalize_query(query)
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
    query = normalize_query(query)
    keywords = keywords if keywords is not None else _extract_keywords(query)
    keywords = [normalize_query(kw) for kw in keywords]
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
    doc_keyword_hits: dict[int, set[str]] = {}
    rows_by_doc: dict[int, list] = {}
    for r in db.execute(stmt).all():
        matched = {kw for kw in keywords if kw.lower() in r.content.lower()}
        if not matched:
            continue
        doc_keyword_hits.setdefault(r.document_id, set()).update(matched)
        rows_by_doc.setdefault(r.document_id, []).append((len(matched), r))

    ranked_doc_ids = sorted(
        doc_keyword_hits,
        key=lambda doc_id: len(doc_keyword_hits[doc_id]),
        reverse=True,
    )

    results: list[RetrievedChunk] = []
    for doc_id in ranked_doc_ids:
        if len(results) >= top_k:
            break
        doc_score = len(doc_keyword_hits[doc_id]) / len(keywords)
        # ในเอกสารเดียวกัน เอา chunk ที่คำตรงเยอะสุดก่อน (ตัวแทนเนื้อหาที่ดีสุด)
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
