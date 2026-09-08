"""
schemas/stats.py — Pydantic schema สำหรับ Conversation Stats API (แดชบอร์ดสถิติหัวข้อบทสนทนา)
"""
from datetime import date

from pydantic import BaseModel

from app.models.enums import Topic


class DailyConversationCountOut(BaseModel):
    date: date
    count: int


class TopicCountOut(BaseModel):
    topic: Topic
    label: str  # label ภาษาไทยสั้น ๆ (จาก topic_classifier.TOPIC_LABELS) ให้ frontend ไม่ต้อง map เอง
    count: int


class ConversationStatsOut(BaseModel):
    """หมายเหตุสำคัญสำหรับหน้าแดชบอร์ด (ดู CLAUDE.md/README ถ้าจะแก้ต่อ):

    - total_conversations นับ session ทุกสถานะ **ยกเว้น NOISE** (ทุกวันนี้ noise_count จะเป็น 0
      เสมอเพราะยังไม่มีตรรกะตัดสิน "session ขยะ" ใน classifier จริง — เป็นงานที่ยังไม่ได้ทำ ไม่ใช่
      บั๊ก ฟิลด์นี้เตรียมไว้ล่วงหน้าเผื่ออนาคต)
    - unclassified_count นับจาก tags IS NULL (ไม่ใช่ status field) เพราะ status ของทุก session
      ที่ผ่าน session_tracker.py ถูกตั้งเป็น "unclassified" คงที่ตลอดไปโดยตั้งใจ (ดู
      session_tracker.py: "classifier ไม่แตะ status") — status แทนแกนอื่น (คุณภาพคำตอบ:
      answered/fallback/out_of_scope) ที่ยังไม่มีใครเขียนด้วยเช่นกัน ไม่ใช่สัญญาณว่า classify
      สำเร็จหรือไม่ ต้องดู tags แทนเสมอ
    - other_count คือ session ที่มี tag "other" ปนอยู่ (นับซ้อนกับ topic อื่นได้ เพราะ 1 session
      ติดได้หลาย tag) แยกจาก unclassified_count เสมอ (classify สำเร็จแต่ enum ไม่ครอบคลุม
      ≠ classify ไม่สำเร็จเลย)
    """

    start_date: date
    end_date: date
    total_conversations: int
    noise_count: int
    unclassified_count: int
    other_count: int
    daily_counts: list[DailyConversationCountOut]
    top_topics: list[TopicCountOut]
