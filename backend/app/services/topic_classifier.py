"""
services/topic_classifier.py — จัดหมวดหมู่หัวข้อบทสนทนา 1 session เป็น Topic tag(s) (PDPA-safe)

*** ใช้ get_llm_client() ตัวเดิม ไม่ใช่ Gemini ***
  งานนี้คือ classification จาก enum ปิด ไม่ใช่ retrieval — ไม่ต้องมี RAG และไม่เกี่ยวกับ Gemini Live
  เลย (แยกจาก voice session/WS โดยสิ้นเชิง เรียกได้แม้ Gemini session ปิดไปแล้ว) reuse
  app/llm/chat.py:get_llm_client() แบบเดียวกับที่ Chat Demo ในแอดมินใช้ (DeepSeek/Claude/fake ตาม
  LLM_PROVIDER ใน .env)

*** input ที่รับได้ ***
  รับแค่ "สัญญาณ" ที่เก็บมาจาก SessionTracker.record_signal() เท่านั้น (ดู session_tracker.py):
  query ที่ Gemini แปลงแล้วตอนเรียก search_camt_knowledge_base, topic ที่ Gemini สรุปตอนเรียก
  flag_off_topic, และข้อความที่แมวพูดตอบ (output_transcription) — ไม่ใช่คำพูดดิบของผู้ใช้เลย
  สักคำ ฟังก์ชันนี้ไม่รู้จัก ไม่รับ ไม่มีช่องให้ใส่ transcript ดิบด้วยซ้ำ

*** other_hint ต้องเป็นคำสรุปของ LLM เอง ***
  บังคับผ่าน prompt (ห้ามคัดลอก signal ที่ให้มาตรง ๆ) — โค้ดฝั่งนี้ validate แค่ความยาว (ตัดเหลือ
  ไม่เกิน 10 คำถ้า LLM ตอบยาวเกิน) ไม่ตรวจเนื้อหาว่าคัดลอกมาหรือไม่ (ทำแบบ deterministic ไม่ได้จริง)

*** ล้มเหลวได้ ต้องไม่ทำ session หาย ***
  คืน None ทุกกรณีที่ล้มเหลว (LLM error, parse ไม่ได้, ไม่มี tag ที่ valid เลย) — ผู้เรียก
  (session_tracker.py) จะปล่อยแถวที่ insert ไปแล้วไว้เป็น UNCLASSIFIED/tags=None ไม่ retry ไม่ error
  ทำให้ analytics session หาย
"""
from __future__ import annotations

import json
import logging

from app.llm.chat import get_llm_client
from app.models.enums import Topic

logger = logging.getLogger("services.topic_classifier")

MAX_OTHER_HINT_WORDS = 10

# label ภาษาไทยสั้น ๆ ต่อ Topic — ใช้แต่งเป็น prompt เท่านั้น (ไม่ได้ผูกกับ enums.py โดยตรงเพราะ
# comment ใน enum อ่านตอน runtime ไม่ได้) ต้องอัปเดตคู่กันถ้าเพิ่ม/แก้ Topic ใน models/enums.py
_TOPIC_LABELS: dict[Topic, str] = {
    Topic.CURRICULUM_SE: "หลักสูตรวิศวกรรมซอฟต์แวร์ (SE)",
    Topic.CURRICULUM_DII: "หลักสูตรบูรณาการอุตสาหกรรมดิจิทัล (DII)",
    Topic.CURRICULUM_DTM: "หลักสูตรการจัดการเทคโนโลยีดิจิทัล (DTM)",
    Topic.CURRICULUM_MMIT: "หลักสูตร MMIT",
    Topic.CURRICULUM_KIM: "หลักสูตรการจัดการความรู้ (KIM)",
    Topic.CURRICULUM_ANI: "หลักสูตรแอนิเมชันและวิชวลเอฟเฟกต์ (ANI)",
    Topic.CURRICULUM_DG: "หลักสูตรดิจิทัลเกม (DG)",
    Topic.ADMISSION: "การรับสมัคร / คุณสมบัติผู้สมัคร / TCAS / Portfolio",
    Topic.TUITION_FEE: "ค่าธรรมเนียมการศึกษา / ค่าเทอม",
    Topic.CAREER_PATH: "เส้นทางอาชีพหลังเรียนจบ",
    Topic.FACILITIES_EQUIPMENT: "อุปกรณ์/ห้องแล็บของ DITC (VR, โดรน, 3D printing, สตูดิโอ ฯลฯ)",
    Topic.CONTACT_HOURS: "เบอร์โทร / ที่อยู่ / เวลาทำการ / ช่องทางติดต่อ",
    Topic.NEWS_EVENTS: "ข่าว / กิจกรรม / โครงการอบรม / KIND by CAMT",
    Topic.STAFF_ORG: "บุคลากร / โครงสร้างองค์กร / ผู้บริหาร",
    Topic.GRADUATE_STUDIES: "การศึกษาระดับบัณฑิตศึกษา (ปริญญาโท-เอก)",
    Topic.GREETING_SMALLTALK: "ทักทาย/คุยเล่นอย่างเดียว ไม่มีคำถามเกี่ยวกับ CAMT/DITC จริง",
    Topic.OTHER: "จัดหมวดตามลิสต์ด้านบนไม่ได้เลย (ต้องใส่ other_hint ด้วยเสมอถ้าเลือกอันนี้)",
}

_SYSTEM_PROMPT = (
    "คุณเป็นตัวช่วยจัดหมวดหมู่หัวข้อบทสนทนาของ DITC CAT (แชทบอทตอบคำถามของศูนย์ DITC และคณะ CAMT "
    "มหาวิทยาลัยเชียงใหม่) งานของคุณ: อ่าน \"สัญญาณ\" ที่สรุปมาจากบทสนทนาหนึ่งครั้ง (คำค้นที่ระบบใช้ "
    "ค้นฐานความรู้ + หัวข้อที่ถูกปฏิเสธเพราะนอกเรื่อง + ข้อความที่แมวพูดตอบ — ไม่ใช่คำพูดของผู้ใช้เอง) "
    "แล้วเลือกหัวข้อ (tag) จากลิสต์ตายตัวด้านล่างเท่านั้น ห้ามคิดคำใหม่เอง ห้ามแก้คำในลิสต์\n\n"
    "ลิสต์หัวข้อ (key -> ความหมาย):\n"
    + "\n".join(f"{topic.value} -> {label}" for topic, label in _TOPIC_LABELS.items())
    + "\n\nกติกา:\n"
    "- เลือกได้หลายหัวข้อถ้าเกี่ยวข้องจริง ต้องเลือกอย่างน้อย 1 หัวข้อเสมอ\n"
    "- ถ้าไม่มีหัวข้อไหนในลิสต์ตรงกับเนื้อหาเลย ให้เลือก \"other\" แล้วเขียน other_hint สั้น ๆ (ไม่เกิน "
    "10 คำ ภาษาไทย) สรุปเป็นคำพูดของคุณเองว่าเนื้อหานี้ควรเป็นหัวข้อใหม่ชื่ออะไร "
    "ห้ามคัดลอกสัญญาณที่ให้มาตรง ๆ เด็ดขาด ต้องเขียนสรุปขึ้นใหม่\n"
    "- ถ้าเลือก \"other\" ต้องมี other_hint เสมอ ถ้าไม่ได้เลือก \"other\" ให้ other_hint เป็น null\n"
    "- ตอบเป็น JSON เท่านั้น รูปแบบ {\"tags\": [\"...\"], \"other_hint\": \"...\" หรือ null} "
    "ห้ามมีข้อความอื่นนอกเหนือจาก JSON ห้ามใส่ ```"
)


def classify_session_topics(signals: list[str]) -> tuple[list[str], str | None] | None:
    """เรียก LLM ครั้งเดียว คืน (tags, other_hint) หรือ None ถ้าล้มเหลว/parse ไม่ได้/ไม่มี tag valid
    เลยสักตัว — เป็น sync/blocking (เรียก httpx ตรง ๆ ผ่าน LLMClient.complete) ผู้เรียกต้องเรียกผ่าน
    run_in_executor เอง (ดู session_tracker.py) ห้ามเรียกตรงจาก event loop"""
    if not signals:
        return None

    user_message = "\n".join(f"- {s}" for s in signals)

    try:
        llm = get_llm_client()
        raw = llm.complete(_SYSTEM_PROMPT, user_message, max_tokens=200)
        start = raw.index("{")
        end = raw.rindex("}") + 1
        parsed = json.loads(raw[start:end])
    except Exception:
        logger.exception("topic_classifier: เรียก/parse LLM ไม่สำเร็จ")
        return None

    tags_raw = parsed.get("tags")
    if not isinstance(tags_raw, list):
        logger.warning("topic_classifier: response ไม่มี tags เป็น list (raw=%r)", parsed)
        return None

    valid_topic_values = {t.value for t in Topic}
    tags = [t for t in tags_raw if isinstance(t, str) and t in valid_topic_values]
    if not tags:
        logger.warning("topic_classifier: ไม่มี tag ที่ valid เลยใน response (raw=%r)", parsed)
        return None

    other_hint = parsed.get("other_hint") if Topic.OTHER.value in tags else None
    if isinstance(other_hint, str):
        words = other_hint.split()
        if len(words) > MAX_OTHER_HINT_WORDS:
            other_hint = " ".join(words[:MAX_OTHER_HINT_WORDS])
    else:
        other_hint = None

    return tags, other_hint
