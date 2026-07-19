"""
enums.py — ค่าคงที่แบบ Enum ที่ใช้ในหลายตาราง
ใช้ str, Enum เพื่อให้ค่าที่เก็บใน DB เป็นข้อความอ่านง่าย (ไม่ใช่ตัวเลข)
"""
from enum import Enum


class SourceSite(str, Enum):
    """เว็บต้นทางของ Knowledge Base"""
    DITC = "ditc"          # ditc.camt.cmu.ac.th
    CAMT = "camt"          # camt.cmu.ac.th
    MANUAL = "manual"      # แอดมินเพิ่มเองผ่านเว็บจัดการ (T28)


class Language(str, Enum):
    """ภาษาที่ระบบรองรับ (auto-detect ตาม Scope ข้อ 9)"""
    TH = "th"
    EN = "en"


class SessionStatus(str, Enum):
    """ผลลัพธ์ของแต่ละบทสนทนา — ใช้ทำสถิติในแดชบอร์ด (Scope 6.3)"""
    ANSWERED = "answered"            # ตอบได้จาก Knowledge Base
    FALLBACK = "fallback"            # ดึงข้อมูลสดมาตอบ (Scope 3.7)
    OUT_OF_SCOPE = "out_of_scope"    # นอกเรื่อง CAMT/DITC ระบบปฏิเสธสุภาพ (Scope 3.6)
    UNCLASSIFIED = "unclassified"    # จัดหมวดไม่ได้ (Scope 6.3)


class SessionEndReason(str, Enum):
    """สาเหตุที่จบบทสนทนา (Scope 2.5)"""
    USER_GOODBYE = "user_goodbye"    # ผู้ใช้พูดคำปิดท้าย เช่น "ขอบคุณค่ะ/ครับ"
    TIMEOUT = "timeout"              # เงียบเกินเวลาที่กำหนด
    UNKNOWN = "unknown"


class FeedbackCategory(str, Enum):
    """หมวดหมู่ฟีดแบค (Scope 8.4) — AI สรุปให้"""
    CONTENT_SUGGESTION = "content_suggestion"  # ข้อเสนอแนะเนื้อหา
    USABILITY = "usability"                    # ปัญหาการใช้งาน
    PRAISE = "praise"                          # คำชม
    OTHER = "other"                            # อื่น ๆ


class Sentiment(str, Enum):
    """โทนความคิดเห็น (Scope 8.4)"""
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"


class AdminRole(str, Enum):
    """สิทธิ์ผู้ดูแลระบบ (ใช้ตอน T27)"""
    ADMIN = "admin"
    EDITOR = "editor"
