"""
embedding.py — แปลงข้อความเป็นเวกเตอร์ (embedding) สำหรับ semantic search

รองรับหลาย provider (สลับที่ .env → EMBEDDING_PROVIDER):
    e5     → multilingual-e5-large รันเองบนเครื่อง (ฟรี ไม่ต้องมี key, ผ่านการเทียบกับ BGE-M3 แล้ว
             ดู docs/adr/embedding-model.md — เลือกตัวนี้เพราะ recall@3 สูงกว่า + ไม่มีอาการ
             "เอกสารเดียวครอบจักรวาล" แบบที่ BGE-M3 เป็น)
    openai → เรียก OpenAI Embeddings API (คุณภาพดี, ต้องมี key + เสียเงิน) — สำรองไว้เผื่ออนาคต
    fake   → เวกเตอร์จำลองแบบ deterministic (ไม่ต้องมี key/เน็ต) — ใช้ทดสอบ pipeline/CI เท่านั้น
             ⚠️ ไม่มีความหมายเชิงภาษา ใช้พิสูจน์ว่า"ท่อ"ทำงาน ไม่ใช่วัดคุณภาพการค้น

สำคัญ: embedder.dim อ่านจาก "โมเดลจริงตอนโหลด" (ไม่ใช่พิมพ์เดาไว้ใน .env) เพื่อกันปัญหาที่เจอจริงตอน
เปลี่ยนจาก text-embedding-3-small (1536) มา e5-large (1024) — ถ้าพิมพ์ผิดใน .env จะรู้ตัวช้ามาก
main.py จะเช็คตอน startup ว่า dim ตรงกับคอลัมน์ใน DB จริงไหม ไม่ตรง = fail ทันทีพร้อม error ชัดเจน
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

    dim: int  # ต้องตั้งจากโมเดล/API จริงใน __init__ ของ subclass ห้าม hardcode เดา

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


class SentenceTransformerEmbedder(Embedder):
    """
    รันโมเดล embedding เองบนเครื่อง ผ่าน sentence-transformers (ไม่ต้องมี API key, ฟรี)
    เลือก multilingual-e5-large หลัง benchmark เทียบกับ BGE-M3 แล้ว (ดู docs/adr/embedding-model.md)

    e5 ต้องมี prefix "query: "/"passage: " ตามสเปคที่โมเดลเทรนมา (ไม่ใส่ = แม่นยำลดลงชัดเจน
    วัดจริงตอน benchmark) ตรวจจากชื่อโมเดลว่ามี "e5" อยู่ไหมเพื่อตัดสินใจใส่ prefix อัตโนมัติ
    """

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer  # import ช้า โหลดเฉพาะตอนใช้จริง

        logger.info("กำลังโหลดโมเดล embedding: %s (อาจใช้เวลาสักครู่ตอนแรก)", model_name)
        self._model = SentenceTransformer(model_name)
        # อ่าน dim จากโมเดลจริงที่โหลดมา ไม่เดาจาก config — กันเคสพิมพ์ EMBEDDING_DIM ผิด
        self.dim = self._model.get_sentence_embedding_dimension()
        self._is_e5 = "e5" in model_name.lower()
        logger.info("โหลดเสร็จ: %s (dim=%d)", model_name, self.dim)

    def embed(self, texts: list[str]) -> list[list[float]]:
        prefixed = [f"passage: {t}" if self._is_e5 else t for t in texts]
        vectors = self._model.encode(prefixed, normalize_embeddings=True, show_progress_bar=False)
        return vectors.tolist()

    def embed_one(self, text: str) -> list[float]:
        # คำถามผู้ใช้ต้องใช้ prefix "query: " (คนละ prefix กับเนื้อหาเอกสารที่ index ไว้)
        prefixed = f"query: {text}" if self._is_e5 else text
        vector = self._model.encode([prefixed], normalize_embeddings=True, show_progress_bar=False)[0]
        return vector.tolist()


_embedder_cache: Embedder | None = None


def get_embedder() -> Embedder:
    """
    โรงงานสร้าง embedder ตาม settings.EMBEDDING_PROVIDER
    เรียกใช้ที่อื่นด้วย:  embedder = get_embedder()

    แคชไว้เป็น singleton (module-level) เพราะ SentenceTransformerEmbedder โหลดโมเดลช้า (~10s)
    เรียกทุก request แล้วโหลดใหม่ทุกครั้งจะทำให้ latency พังทันที
    """
    global _embedder_cache
    if _embedder_cache is not None:
        return _embedder_cache

    provider = settings.EMBEDDING_PROVIDER.lower()
    dim = settings.EMBEDDING_DIM

    if provider == "fake":
        logger.info("ใช้ FakeEmbedder (dim=%d) — สำหรับทดสอบเท่านั้น", dim)
        _embedder_cache = FakeEmbedder(dim=dim)

    elif provider == "openai":
        _embedder_cache = OpenAIEmbedder(
            model=settings.EMBEDDING_MODEL,
            dim=dim,
            api_key=settings.OPENAI_API_KEY,
        )

    elif provider == "e5":
        _embedder_cache = SentenceTransformerEmbedder(model_name=settings.EMBEDDING_MODEL)

    else:
        raise ValueError(
            f"EMBEDDING_PROVIDER '{provider}' ไม่รองรับ (มีให้: e5 | openai | fake)"
        )

    return _embedder_cache
