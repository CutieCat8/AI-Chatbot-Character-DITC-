"""
schemas/chat.py — request/response ของหน้าแชทถามตอบ (demo)
"""
from pydantic import BaseModel

from app.models.enums import SourceSite


class ChatRequest(BaseModel):
    question: str


class ChatSourceOut(BaseModel):
    document_id: int
    title: str | None
    url: str
    source_site: SourceSite
    similarity: float


class ChatResponse(BaseModel):
    answer: str
    sources: list[ChatSourceOut]
