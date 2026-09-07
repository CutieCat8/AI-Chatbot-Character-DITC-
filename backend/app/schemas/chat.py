"""
schemas/chat.py — request/response ของหน้าแชทถามตอบ (demo)
"""
from pydantic import BaseModel, Field

from app.models.enums import SourceSite

# จำนวนเทิร์นก่อนหน้าที่รับได้มากที่สุด — จำกัดไว้เพราะยิ่งแนบมาก prompt ยิ่งใหญ่และช้าลง
# 3 เทิร์นพอสำหรับคำถามต่อเนื่องแบบ "แล้วค่าเทอมล่ะ" ซึ่งอ้างถึงเรื่องที่เพิ่งคุยกันไม่กี่ประโยคก่อน
MAX_HISTORY_TURNS = 3


class ChatTurn(BaseModel):
    question: str
    answer: str


class ChatRequest(BaseModel):
    question: str
    # บทสนทนาก่อนหน้าที่ frontend ส่งกลับมาเอง — เซิร์ฟเวอร์ไม่เก็บลงฐานข้อมูล
    # (PRD ข้อ 4.1 สั่งว่าไม่เก็บบทสนทนาแบบเต็ม ให้สรุปเป็นหัวข้อ/แท็กเท่านั้น)
    # มีไว้เพื่อให้คำถามต่อเนื่องอย่าง "แล้วค่าเทอมล่ะ" รู้ว่ากำลังพูดถึงหลักสูตรไหนอยู่
    history: list[ChatTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)


class ChatSourceOut(BaseModel):
    document_id: int
    title: str | None
    url: str
    source_site: SourceSite
    similarity: float


class ChatResponse(BaseModel):
    answer: str
    sources: list[ChatSourceOut]
