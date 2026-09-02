"""
llm/chat.py — เรียก LLM มาแต่งคำตอบจากผลค้น RAG (chat demo)

รองรับหลาย provider (สลับที่ .env → LLM_PROVIDER) เหมือนแนวทางของ app/rag/embedding.py:
    claude   → เรียก Anthropic Messages API
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
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# Anthropic Messages API บังคับต้องมี max_tokens เสมอ (ต่างจาก OpenAI-compatible ที่เป็น optional)
DEFAULT_MAX_TOKENS = 1024


class LLMClient(ABC):
    """อินเทอร์เฟซกลางของ LLM chat ทุกตัว"""

    @abstractmethod
    def complete(self, system: str, user: str, max_tokens: int | None = None) -> str:
        """ส่ง system prompt + user message → คืนคำตอบเป็นข้อความ
        max_tokens: จำกัดความยาวคำตอบ (สำคัญมากสำหรับบทสนทนาด้วยเสียง — คำตอบยาวเกินไป
        ทำให้รอนานและฟังดูไม่เป็นธรรมชาติ) ไม่ใส่ = ให้โมเดลตอบยาวได้อิสระ (ใช้กับงานอื่นที่ไม่ใช่บทสนทนา)
        """


class FakeLLMClient(LLMClient):
    """จำลองคำตอบ ไม่เรียก API จริง — ใช้ทดสอบท่อ endpoint โดยไม่ต้องมี key"""

    def complete(self, system: str, user: str, max_tokens: int | None = None) -> str:
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

    def complete(self, system: str, user: str, max_tokens: int | None = None) -> str:
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
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(DEEPSEEK_CHAT_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]


class ClaudeClient(LLMClient):
    """เรียก Anthropic Messages API ตรง ๆ ด้วย httpx"""

    def __init__(self, api_key: str, model: str, timeout: float = 60.0) -> None:
        if not api_key:
            raise RuntimeError(
                "ไม่มี ANTHROPIC_API_KEY — ตั้งค่าใน .env หรือสลับ LLM_PROVIDER=fake ตอนทดสอบ"
            )
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def complete(self, system: str, user: str, max_tokens: int | None = None) -> str:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        }
        payload = {
            "model": self.model,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "temperature": 0.3,
            "max_tokens": max_tokens if max_tokens is not None else DEFAULT_MAX_TOKENS,
        }
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(ANTHROPIC_MESSAGES_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return "".join(block["text"] for block in data["content"] if block["type"] == "text")



# รายชื่อหลักสูตรจริงของ CAMT (เช็คจาก DB) — ให้ LLM ไว้ในหัวตอนแตกคำค้น เพราะ "fake" embedding
# ไม่ได้ทำ semantic search จริง (ดู FakeEmbedder) การจะเจอหลักสูตรที่ "เกี่ยวข้องแต่คำไม่ตรงเป๊ะ"
# (เช่น ถามเรื่อง dev แต่มี DII ที่เป็น dev ผสมสายธุรกิจด้วย) ต้องพึ่งการแตกคำที่รู้จักหลักสูตรจริงแทน
_CAMT_PROGRAMS = (
    "SE = วิศวกรรมซอฟต์แวร์ (Software Engineering, เขียนโปรแกรม/พัฒนาซอฟต์แวร์ล้วน ๆ)\n"
    "DII = บูรณาการอุตสาหกรรมดิจิทัล (Digital Industry Integration, dev ผสมสายธุรกิจ/อุตสาหกรรม)\n"
    "DTM = การจัดการเทคโนโลยีดิจิทัล (Digital Technology Management, สายจัดการเทคโนโลยี ไม่เน้นเขียนโค้ด)\n"
    "MMIT = การจัดการสมัยใหม่และเทคโนโลยีสารสนเทศ (สาย IT ผสมบริหารจัดการ)\n"
    "KIM = การจัดการความรู้ (Knowledge and Innovation Management, สายบริหารความรู้/นวัตกรรม)\n"
    "ANI = แอนิเมชันและวิชวลเอฟเฟกต์ (สายสื่อ/กราฟิก ไม่ใช่ dev)\n"
    "DG = ดิจิทัลเกม (Digital Games, พัฒนาเกม)"
)

_EXPAND_SYSTEM_PROMPT = (
    "คุณเป็นตัวช่วยแปลงคำถามของผู้ใช้ให้เป็น \"คำค้น\" สำหรับค้นในเว็บของศูนย์ DITC และคณะ CAMT "
    "มหาวิทยาลัยเชียงใหม่ (เว็บเป็นภาษาไทยเป็นหลัก พูดถึงชื่อหลักสูตร/สาขา ค่าเทอม คุณสมบัติผู้สมัคร "
    "อาชีพที่ทำได้ ฯลฯ)\n"
    "งานของคุณ: อ่านคำถาม (อาจเขียนไม่เป็นทางการ/มีคำทับศัพท์อังกฤษ/พูดถึงเป้าหมายอาชีพ) "
    "แล้วนึกว่าเว็บ CAMT จะใช้คำแบบไหนพูดถึงเรื่องนี้ เช่น ถ้าถามเรื่องอยากเป็น full-stack developer "
    "ให้แตกเป็นคำอย่าง \"เขียนโปรแกรม\" \"Software developer\" \"วิศวกรรมซอฟต์แวร์\" \"หลักสูตร\" "
    "\"ปริญญาตรี\" ไม่ใช่คำว่า \"full-stack\" ตรงๆ เพราะเว็บอาจไม่ได้ใช้คำนี้\n"
    "นี่คือหลักสูตรทั้งหมดของ CAMT (ใช้ตัดสินใจว่าหลักสูตรไหน \"เกี่ยวข้อง\" กับคำถามบ้าง แม้คำถามจะไม่ได้ "
    "เอ่ยชื่อหลักสูตรตรง ๆ):\n" + _CAMT_PROGRAMS + "\n"
    "ถ้าคำถามเกี่ยวกับสายอาชีพ/ความสนใจที่ตรงกับหลักสูตรมากกว่า 1 อัน (เช่น ถามเรื่อง dev "
    "ตรงกับทั้ง SE และ DII) ให้ใส่ชื่อย่อหลักสูตร (เช่น \"SE\" \"DII\") เป็นคำค้นด้วยเสมอ ไม่ใช่แค่อันที่ตรงที่สุด "
    "เพื่อให้ระบบดึงข้อมูลของหลักสูตรที่เกี่ยวข้องทั้งหมดมาได้\n"
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
        raw = llm.complete(_EXPAND_SYSTEM_PROMPT, question, max_tokens=150)
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

    if provider == "claude":
        return ClaudeClient(api_key=settings.ANTHROPIC_API_KEY, model=settings.ANTHROPIC_MODEL)

    raise ValueError(
        f"LLM_PROVIDER '{provider}' ไม่รองรับ (มีให้: claude | deepseek | fake)"
    )
