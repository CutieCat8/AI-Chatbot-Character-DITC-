"""
embedding.py — แปลงข้อความเป็นเวกเตอร์ (embedding) สำหรับ semantic search

รองรับหลาย provider (สลับที่ .env → EMBEDDING_PROVIDER):
    openai → เรียก OpenAI Embeddings API (คุณภาพดี, ต้องมี key + เสียเงิน)
    fake   → เวกเตอร์จำลองแบบ deterministic (ไม่ต้องมี key/เน็ต) — ใช้ทดสอบ pipeline/CI เท่านั้น
             ⚠️ ไม่มีความหมายเชิงภาษา ใช้พิสูจน์ว่า"ท่อ"ทำงาน ไม่ใช่วัดคุณภาพการค้น

ทุก provider ต้องคืนเวกเตอร์ยาว = settings.EMBEDDING_DIM (มิติต้องตรงกับคอลัมน์ใน DB)
ออกแบบเป็น abstraction เพื่อให้ตอนล็อก provider จริง (Sprint 2) แก้ที่เดียว
"""
from __future__ import annotations

import hashlib
import logging
import math
from abc import ABC, abstractmethod

import httpx

from app.config import settings

logger = logging.getLogger("rag.embedding")

OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"


class Embedder(ABC):
    """อินเทอร์เฟซกลางของ embedder ทุกตัว"""

    dim: int

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """แปลงหลายข้อความพร้อมกัน → list ของเวกเตอร์ (ลำดับตรงกับ input)"""

    def embed_one(self, text: str) -> list[float]:
        """แปลงข้อความเดียว → เวกเตอร์เดียว (ใช้ตอน embed คำถามผู้ใช้)"""
        return self.embed([text])[0]


class FakeEmbedder(Embedder):
    """
    embedder จำลอง: สร้างเวกเตอร์จาก hash ของข้อความ (deterministic — ข้อความเดิมได้เวกเตอร์เดิม)
    ทำ normalize ให้ norm=1 เพื่อให้ cosine distance คำนวณได้เหมือนของจริง
    มีไว้ทดสอบ chunking/indexer/retrieval โดยไม่ต้องพึ่ง API — ห้ามใช้ตัดสินคุณภาพการค้น
    """

    def __init__(self, dim: int) -> None:
        self.dim = dim

    def _vector_for(self, text: str) -> list[float]:
        # ใช้ hash ต่อ index เป็น seed สร้างตัวเลข -> ได้เวกเตอร์คงที่ต่อข้อความ
        vec: list[float] = []
        for i in range(self.dim):
            h = hashlib.sha256(f"{i}:{text}".encode("utf-8")).digest()
            # แปลง 8 ไบต์แรกเป็นเลขช่วง [-1, 1)
            n = int.from_bytes(h[:8], "big") / (1 << 64)
            vec.append(n * 2 - 1)
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector_for(t) for t in texts]


class OpenAIEmbedder(Embedder):
    """
    เรียก OpenAI Embeddings API ตรง ๆ ด้วย httpx (ไม่พึ่ง SDK เพิ่ม)
    ส่งเป็น batch ได้ (input เป็น list) — ประหยัดจำนวน request
    """

    def __init__(self, model: str, dim: int, api_key: str, batch_size: int = 100) -> None:
        if not api_key:
            raise RuntimeError(
                "ไม่มี OPENAI_API_KEY — ตั้งค่าใน .env หรือสลับ EMBEDDING_PROVIDER=fake ตอนทดสอบ"
            )
        self.model = model
        self.dim = dim
        self.api_key = api_key
        self.batch_size = batch_size

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        headers = {"Authorization": f"Bearer {self.api_key}"}
        with httpx.Client(timeout=60.0) as client:
            # แบ่งเป็นก้อนละ batch_size กัน payload ใหญ่เกิน/โดน rate limit
            for start in range(0, len(texts), self.batch_size):
                batch = texts[start : start + self.batch_size]
                resp = client.post(
                    OPENAI_EMBEDDINGS_URL,
                    headers=headers,
                    json={"model": self.model, "input": batch},
                )
                resp.raise_for_status()
                data = resp.json()["data"]
                # API การันตีลำดับตาม index — เรียงให้ชัวร์อีกชั้น
                data.sort(key=lambda d: d["index"])
                vectors.extend(d["embedding"] for d in data)
        return vectors


def get_embedder() -> Embedder:
    """
    โรงงานสร้าง embedder ตาม settings.EMBEDDING_PROVIDER
    เรียกใช้ที่อื่นด้วย:  embedder = get_embedder()
    """
    provider = settings.EMBEDDING_PROVIDER.lower()
    dim = settings.EMBEDDING_DIM

    if provider == "fake":
        logger.info("ใช้ FakeEmbedder (dim=%d) — สำหรับทดสอบเท่านั้น", dim)
        return FakeEmbedder(dim=dim)

    if provider == "openai":
        return OpenAIEmbedder(
            model=settings.EMBEDDING_MODEL,
            dim=dim,
            api_key=settings.OPENAI_API_KEY,
        )

    raise ValueError(
        f"EMBEDDING_PROVIDER '{provider}' ไม่รองรับ (มีให้: openai | fake)"
    )
