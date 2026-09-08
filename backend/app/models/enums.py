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
    NOISE = "noise"                  # session ขยะ — คนเดินผ่าน/เสียงรบกวน/ไม่ถามอะไรเลย
                                      # (ตัดสินใจร่วมกับผู้ว่าจ้าง 2026-09-08: บันทึกไว้ แยกสถานะ
                                      # ไม่ทิ้งข้อมูล เพราะมีประโยชน์เป็น facility-usage metric
                                      # แยกจาก "session ที่มีคนถามจริง" — ห้ามรวมกับสถิติหัวข้อ/แนวโน้ม)


class Topic(str, Enum):
    """หัวข้อบทสนทนา — enum ตายตัว ห้าม LLM คิดคำเอง (กันปัญหา "ค่าเทอม" vs "ค่าเล่าเรียน"
    แยกกันจนสถิติใช้ไม่ได้) ตั้งต้นจากเนื้อหาจริงที่ scrape มาจากเว็บ ditc.camt.cmu.ac.th /
    camt.cmu.ac.th (ดู backend/data/*.json) — หนึ่ง session ติดได้หลาย tag
    รายชื่อหลักสูตรอ้างอิงจาก _CAMT_PROGRAMS ใน app/llm/chat.py
    OTHER คือถังพักสำหรับคำถามที่จัดหมวดไม่ได้ ให้ผู้ดูแลรีวิวเพิ่มหัวข้อทีหลัง (ดู other_hint
    ใน ConversationSession)"""
    CURRICULUM_SE = "curriculum_se"                  # วิศวกรรมซอฟต์แวร์
    CURRICULUM_DII = "curriculum_dii"                # บูรณาการอุตสาหกรรมดิจิทัล
    CURRICULUM_DTM = "curriculum_dtm"                # การจัดการเทคโนโลยีดิจิทัล
    CURRICULUM_MMIT = "curriculum_mmit"
    CURRICULUM_KIM = "curriculum_kim"                # การจัดการความรู้
    CURRICULUM_ANI = "curriculum_ani"                # แอนิเมชันและวิชวลเอฟเฟกต์
    CURRICULUM_DG = "curriculum_dg"                  # ดิจิทัลเกม
    ADMISSION = "admission"                          # การรับสมัคร/คุณสมบัติ/TCAS/Portfolio
    TUITION_FEE = "tuition_fee"                      # ค่าธรรมเนียมการศึกษา
    CAREER_PATH = "career_path"                      # จบแล้วทำงานอะไร
    FACILITIES_EQUIPMENT = "facilities_equipment"    # VR/โดรน/3D printing/สตูดิโอของ DITC
    CONTACT_HOURS = "contact_hours"                  # เบอร์โทร/ที่อยู่/เวลาทำการ
    NEWS_EVENTS = "news_events"                      # ข่าว/กิจกรรม/อบรม/KIND by CAMT
    STAFF_ORG = "staff_org"                          # บุคลากร/โครงสร้างองค์กร
    GRADUATE_STUDIES = "graduate_studies"            # ปริญญาโท-เอก
    GREETING_SMALLTALK = "greeting_smalltalk"        # ทักทายอย่างเดียว ไม่มีคำถามจริง
    OTHER = "other"                                  # จัดหมวดไม่ได้ — ดู other_hint


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


class Speaker(str, Enum):
    """ฝั่งที่พูดในแต่ละ turn (conversation_turns) — ไม่มีข้อความ เก็บแค่ว่าใครพูด"""
    USER = "user"
    BOT = "bot"


class AdminRole(str, Enum):
    """สิทธิ์ผู้ดูแลระบบ (ใช้ตอน T27)"""
    ADMIN = "admin"
    EDITOR = "editor"
