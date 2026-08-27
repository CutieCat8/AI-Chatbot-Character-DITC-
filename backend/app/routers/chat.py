"""
routers/chat.py — endpoint สาธิต: รับคำถาม → ค้น RAG → ให้ LLM แต่งคำตอบ (ยังไม่ผ่าน voice pipeline จริง)
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.llm.chat import expand_search_terms, get_llm_client
from app.rag.embedding import get_embedder
from app.rag.retrieval import keyword_search, search
from app.schemas.chat import ChatRequest, ChatResponse, ChatSourceOut

logger = logging.getLogger("routers.chat")

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = (
    "คุณคือ DITC CAT ผู้ช่วยตอบคำถามของศูนย์ DITC และคณะ CAMT มหาวิทยาลัยเชียงใหม่เท่านั้น "
    "ตอบจาก \"ข้อมูลอ้างอิง\" ที่ให้มาด้านล่างเท่านั้น ห้ามเดาหรือแต่งข้อมูลเพิ่ม "
    "ถ้าข้อมูลอ้างอิงไม่พอตอบคำถาม ให้บอกตามตรงว่าไม่มีข้อมูลเรื่องนี้ "
    "ถ้าคำถามไม่เกี่ยวกับ CAMT/DITC ให้ปฏิเสธอย่างสุภาพว่าตอบได้เฉพาะเรื่อง CAMT/DITC "
    "ถ้าข้อมูลอ้างอิงพูดถึงหลายหลักสูตร/สาขาที่เกี่ยวข้องกับคำถาม ห้ามเลือกตอบแค่อันเดียว "
    "ให้สรุปเปรียบเทียบทีละหลักสูตรแยกเป็นข้อ ๆ (จุดเด่น เนื้อหาที่เรียน ระยะเวลา) "
    "เพื่อให้ผู้ถามตัดสินใจเลือกได้เอง "
    "ตอบเป็นภาษาไทย กระชับ อ่านง่าย"
)


@router.post("", response_model=ChatResponse)
def ask(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question ห้ามว่าง")

    llm = get_llm_client()

    # ภาษาไทยไม่มีช่องว่างคั่นคำ ตัดคำถามแบบสนทนาด้วย split() ธรรมดาไม่ได้ผล
    # → ให้ LLM ช่วยแปลงคำถามเป็นคำค้นที่น่าจะตรงกับคำในเว็บ CAMT/DITC จริง ๆ ก่อน
    expanded_terms = expand_search_terms(llm, question)

    # รวม 3 ชุดผลลัพธ์ จำกัดไม่เกิน 2 chunk ต่อ document กันหลักสูตรเดียวฮุบที่หมด
    # (คำถามเปรียบเทียบหลายหลักสูตรต้องมีที่ให้ทุกหลักสูตรติดเข้ามาด้วย)
    # expanded_results มาก่อนเสมอ — เป็นคำค้นที่ LLM แตกมาให้ตรงกับคำในเว็บจริง แม่นกว่ามาก
    # ส่วน keyword_results (ตัดจากคำถามดิบด้วย split ธรรมดา) มักมีคำกว้างเกินไป (เช่น "camt"
    # ที่อยู่ในทุกหน้า) ถ้าเอาไว้ก่อนจะแย่งที่ผลลัพธ์ดี ๆ ไปหมดตอน cap ที่ [:14] ด้านล่าง
    expanded_results = (
        keyword_search(db, question, top_k=10, keywords=expanded_terms, max_per_document=2)
        if expanded_terms
        else []
    )
    keyword_results = keyword_search(db, question, top_k=10, max_per_document=2)
    vector_results = search(db, question, top_k=5, embedder=get_embedder())

    seen_chunks: set[int] = set()
    results = []
    for r in [*expanded_results, *keyword_results, *vector_results]:
        if r.chunk_id not in seen_chunks:
            seen_chunks.add(r.chunk_id)
            results.append(r)
    results = results[:14]

    if not results:
        return ChatResponse(
            answer="ยังไม่มีข้อมูลใน Knowledge Base ที่เกี่ยวข้องกับคำถามนี้เลยครับ",
            sources=[],
        )

    context = "\n\n".join(
        f"[{i + 1}] ({r.document_title or r.source_url})\n{r.content}"
        for i, r in enumerate(results)
    )
    user_message = f"ข้อมูลอ้างอิง:\n{context}\n\nคำถาม: {question}"

    try:
        answer = llm.complete(SYSTEM_PROMPT, user_message)
    except Exception:
        logger.exception("เรียก LLM ไม่สำเร็จ")
        raise HTTPException(status_code=502, detail="เรียก LLM ไม่สำเร็จ ลองใหม่อีกครั้ง")

    # dedup แหล่งอ้างอิงตาม document (เอาอันที่ similarity สูงสุดของแต่ละเอกสาร)
    seen: dict[int, ChatSourceOut] = {}
    for r in results:
        if r.document_id not in seen:
            seen[r.document_id] = ChatSourceOut(
                document_id=r.document_id,
                title=r.document_title,
                url=r.source_url,
                source_site=r.source_site,
                similarity=round(r.similarity, 3),
            )

    return ChatResponse(answer=answer, sources=list(seen.values()))
