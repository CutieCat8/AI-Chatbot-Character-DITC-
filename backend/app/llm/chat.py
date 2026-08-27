"""
llm/chat.py — เรียก LLM มาแต่งคำตอบจากผลค้น RAG (chat demo)

รองรับหลาย provider (สลับที่ .env → LLM_PROVIDER) เหมือนแนวทางของ app/rag/embedding.py:
    deepseek → เรียก DeepSeek API (OpenAI-compatible /chat/completions)
    fake     → ตอบข้อความจำลอง ไม่ต้องมี key (ใช้ทดสอบ endpoint เฉย ๆ)
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

import httpx

from app.config import settings

logger = logging.getLogger("llm.chat")

DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions"


class LLMClient(ABC):
    """อินเทอร์เฟซกลางของ LLM chat ทุกตัว"""

    @abstractmethod
    def complete(self, system: str, user: str) -> str:
        """ส่ง system prompt + user message → คืนคำตอบเป็นข้อความ"""


class FakeLLMClient(LLMClient):
    """จำลองคำตอบ ไม่เรียก API จริง — ใช้ทดสอบท่อ endpoint โดยไม่ต้องมี key"""

    def complete(self, system: str, user: str) -> str:
        return f"(fake LLM) ได้รับคำถามแล้ว: {user[:200]}"


class DeepSeekClient(LLMClient):
    """เรียก DeepSeek Chat Completions API ตรง ๆ ด้วย httpx (format แบบ OpenAI)"""

    def __init__(self, api_key: str, model: str, timeout: float = 60.0) -> None:
        if not api_key:
            raise RuntimeError(
                "ไม่มี DEEPSEEK_API_KEY — ตั้งค่าใน .env หรือสลับ LLM_PROVIDER=fake ตอนทดสอบ"
            )
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def complete(self, system: str, user: str) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.3,
            "stream": False,
        }
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(DEEPSEEK_CHAT_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]


_EXPAND_SYSTEM_PROMPT = (
    "คุณเป็นตัวช่วยแปลงคำถามของผู้ใช้ให้เป็น \"คำค้น\" สำหรับค้นในเว็บของศูนย์ DITC และคณะ CAMT "
    "มหาวิทยาลัยเชียงใหม่ (เว็บเป็นภาษาไทยเป็นหลัก พูดถึงชื่อหลักสูตร/สาขา ค่าเทอม คุณสมบัติผู้สมัคร "
    "อาชีพที่ทำได้ ฯลฯ)\n"
    "งานของคุณ: อ่านคำถาม (อาจเขียนไม่เป็นทางการ/มีคำทับศัพท์อังกฤษ/พูดถึงเป้าหมายอาชีพ) "
    "แล้วนึกว่าเว็บ CAMT จะใช้คำแบบไหนพูดถึงเรื่องนี้ เช่น ถ้าถามเรื่องอยากเป็น full-stack developer "
    "ให้แตกเป็นคำอย่าง \"เขียนโปรแกรม\" \"Software developer\" \"วิศวกรรมซอฟต์แวร์\" \"หลักสูตร\" "
    "\"ปริญญาตรี\" ไม่ใช่คำว่า \"full-stack\" ตรงๆ เพราะเว็บอาจไม่ได้ใช้คำนี้\n"
    "ตอบเป็นคำหรือวลีสั้น ๆ ครั้งละบรรทัด อย่างน้อย 5 อย่างมากสุด 10 บรรทัด "
    "ห้ามมีคำอธิบายอื่นใด ห้ามมีเลขข้อหรือเครื่องหมายนำหน้า"
)


def expand_search_terms(llm: LLMClient, question: str) -> list[str]:
    """
    ให้ LLM แตกคำถามภาษาพูด/ภาษาอังกฤษปน เป็นคำค้นภาษาไทยที่น่าจะตรงกับคำในเว็บ CAMT/DITC จริง ๆ
    จำเป็นเพราะภาษาไทยไม่มีช่องว่างคั่นคำ — ตัดคำด้วย regex/split ธรรมดาจะพลาดคำถามแบบสนทนาเกือบหมด
    ล้มเหลวได้ (เช่น LLM error) → คืน [] แล้วให้ผู้เรียกใช้ fallback เป็นวิธีอื่นต่อ
    """
    try:
        raw = llm.complete(_EXPAND_SYSTEM_PROMPT, question)
    except Exception:
        logger.exception("expand_search_terms: เรียก LLM ไม่สำเร็จ")
        return []

    terms = [line.strip(" -•*\t") for line in raw.splitlines()]
    return [t for t in terms if t]


def get_llm_client() -> LLMClient:
    """โรงงานสร้าง LLM client ตาม settings.LLM_PROVIDER"""
    provider = settings.LLM_PROVIDER.lower()

    if provider == "fake":
        logger.info("ใช้ FakeLLMClient — สำหรับทดสอบเท่านั้น")
        return FakeLLMClient()

    if provider == "deepseek":
        return DeepSeekClient(api_key=settings.DEEPSEEK_API_KEY, model=settings.DEEPSEEK_MODEL)

    raise ValueError(
        f"LLM_PROVIDER '{provider}' ไม่รองรับ (มีให้: deepseek | fake)"
    )
