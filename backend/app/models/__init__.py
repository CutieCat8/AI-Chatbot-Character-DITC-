"""
รวม model ทั้งหมดไว้ที่เดียว เพื่อให้ import ง่ายและ Alembic มองเห็นทุกตาราง
ใช้:  from app.models import Document, ConversationSession, ...
"""
from app.models.admin import AdminUser
from app.models.conversation import ConversationSession
from app.models.feedback import Feedback
from app.models.idle_content import IdleContent
from app.models.knowledge import Document, DocumentChunk

__all__ = [
    "Document",
    "DocumentChunk",
    "ConversationSession",
    "Feedback",
    "IdleContent",
    "AdminUser",
]
