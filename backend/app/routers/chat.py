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
    "กำลังคุยด้วยเสียงกับคนที่ยืนอยู่ตรงหน้า ไม่ใช่แชทข้อความที่มีเวลาอ่านเยอะ ๆ — "
    "ตอบสั้น กระชับ เหมือนคนคุยกันจริง ๆ ปกติ 1-3 ประโยคก็พอ "
    "ตอบจาก \"ข้อมูลอ้างอิง\" ที่ให้มาด้านล่างเท่านั้น ห้ามเดาหรือแต่งข้อมูลเพิ่ม "
    "ถ้าข้อมูลอ้างอิงไม่พอตอบคำถาม ให้บอกตามตรงว่าไม่มีข้อมูลเรื่องนี้ "
    "ถ้าคำถามไม่เกี่ยวกับ CAMT/DITC ให้ปฏิเสธอย่างสุภาพว่าตอบได้เฉพาะเรื่อง CAMT/DITC "
    "ถ้าข้อมูลอ้างอิงพูดถึงหลายหลักสูตร/สาขาที่เกี่ยวข้องกับคำถาม ห้ามท่องรายละเอียดของทุกอันรวด — "
    "ให้พูดถึงชื่อหลักสูตรที่เกี่ยวข้องสั้น ๆ แล้วถามกลับว่าอยากรู้รายละเอียดหลักสูตรไหนเป็นพิเศษ "
    "ถ้ามีหลักสูตรหนึ่งที่ตรงกับคำถามที่สุด (เช่น ถามเรื่องเขียนโปรแกรม → วิศวกรรมซอฟต์แวร์) "
    "ให้ตอบหลักสูตรนั้นเป็นคำแนะนำหลักไปเลย แต่ถ้ามีอีกหลักสูตรที่เกี่ยวข้องแต่ต่างแนวกันชัดเจน "
    "(เช่น หลักสูตรผสมสายธุรกิจ/สายอื่น) ให้แถมท้ายสั้น ๆ ว่ามีตัวเลือกนี้ด้วยและต่างกันตรงไหนคร่าว ๆ "
    "แล้วปิดท้ายด้วยคำถามชวนเทียบสองหลักสูตรนี้ เช่น \"แต่ก็มีอีกสาขาที่เป็น dev ได้เหมือนกันแต่จะเน้นสาย"
    "ธุรกิจร่วมด้วย ไม่ dev ล้วนขนาดนั้น อยากรู้ไหมครับว่าสองหลักสูตรนี้ต่างกันตรงไหน\" "
    "เหมือนคนจริงคุยกัน ห้ามใช้ bullet, เลขข้อ, หรือรูปแบบตาราง เพราะข้อความนี้จะถูกอ่านออกเสียงล้วน ๆ "
    "ลงท้ายประโยคด้วย \"ครับ\" เท่านั้น (ไม่ใช้ \"ค่ะ\" หรือ \"ครับ/ค่ะ\") "
    "ทุกคำตอบ (ยกเว้นตอนปฏิเสธคำถามนอกเรื่อง) ให้ปิดท้ายด้วยคำถามชวนคุยต่อสั้น ๆ 1 คำถามเสมอ "
    "ห้ามใช้คำถามลอย ๆ ที่ใช้ได้กับทุกสถานการณ์แบบ \"มีอะไรอยากถามเพิ่มไหมครับ\" หรือ \"ให้ช่วยอะไรเพิ่มไหมครับ\" "
    "(ห้ามเด็ดขาด) แต่ต้องเจาะจงเสนอหัวข้อจริงที่มาจากข้อมูลอ้างอิงเป็นตัวเลือกให้เลือกเลย "
    "เช่น ถ้าตอบเรื่องหลักสูตรไปแล้ว ให้ถามต่อว่า \"อยากรู้เรื่องค่าเทอม หรือคุณสมบัติผู้สมัครของหลักสูตรนี้ไหมครับ\" "
    "ไม่ใช่ถามกว้าง ๆ — เพื่อช่วยแนะแนวคนที่ไม่รู้จะถามอะไรต่อให้ถามตามได้เลย"
)

# กันไว้ไม่ให้ตอบยาวเกินไป แต่ต้องเผื่อพอให้ตอบจบประโยคเสมอ — ตัดกลางประโยคจะฟังดูขาด ๆ
# หายไปตอนอ่านออกเสียง (ทดสอบจริงแล้วที่ 220 ตัดกลางคำ) 400 คือจุดที่พอเผื่อ 2-3 ประโยคเต็ม ๆ
CHAT_MAX_TOKENS = 400


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
    # ที่อยู่ในทุกหน้า) ถ้าเอาไว้ก่อนจะแย่งที่ผลลัพธ์ดี ๆ ไปหมดตอน cap ที่ [:6] ด้านล่าง
    expanded_results = (
        keyword_search(db, question, top_k=6, keywords=expanded_terms, max_per_document=2)
        if expanded_terms
        else []
    )
    keyword_results = keyword_search(db, question, top_k=6, max_per_document=2)
    vector_results = search(db, question, top_k=4, embedder=get_embedder())

    seen_chunks: set[int] = set()
    results = []
    for r in [*expanded_results, *keyword_results, *vector_results]:
        if r.chunk_id not in seen_chunks:
            seen_chunks.add(r.chunk_id)
            results.append(r)
    # จำกัด context ให้พอดี ๆ (ก่อนหน้านี้ 14 chunk ~ เกือบ 12,000 ตัวอักษร ทำให้ prompt ใหญ่
    # เกินจำเป็นและ LLM ใช้เวลาประมวลผลนานขึ้นมาก) — 6 chunk พอสำหรับตอบสั้น ๆ แบบสนทนา
    results = results[:6]

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
        answer = llm.complete(SYSTEM_PROMPT, user_message, max_tokens=CHAT_MAX_TOKENS)
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
