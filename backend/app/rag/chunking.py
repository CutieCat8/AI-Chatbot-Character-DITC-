"""
chunking.py — ตัด Document เป็นชิ้นเล็ก ๆ (chunk) ก่อนนำไป embed

ทำไมต้อง chunk?
    - โมเดล embedding รับข้อความได้จำกัด
    - การค้น semantic แม่นกว่าเมื่อ 1 เวกเตอร์ = 1 แนวคิดย่อย (ไม่ใช่ทั้งหน้า)

โจทย์ภาษาไทย: ไม่มีเว้นวรรคระหว่างคำ → ตัดแบบนับ "คำ" ไม่ได้
วิธีที่ใช้: รวมทีละย่อหน้า (แบ่งด้วยขึ้นบรรทัด) ให้ได้ก้อนขนาดราว ๆ CHUNK_SIZE ตัวอักษร
           ถ้าย่อหน้าเดียวยาวเกิน ก็หั่นเป็นหน้าต่างซ้อนเหลื่อม (overlap) กันความหมายขาดตอน
"""
from __future__ import annotations

from dataclasses import dataclass

CHUNK_SIZE = 900      # เป้าหมายจำนวนตัวอักษรต่อ chunk
CHUNK_OVERLAP = 150   # จำนวนตัวอักษรที่เหลื่อมกันระหว่าง chunk ติดกัน (กันบริบทขาด)
MIN_CHUNK = 40        # chunk สั้นกว่านี้ถือว่าไม่มีสาระ ทิ้ง


@dataclass
class Chunk:
    index: int          # ลำดับชิ้นใน document (0, 1, 2, ...)
    content: str
    token_count: int    # ประมาณการคร่าว ๆ (ใช้อ้างอิง ไม่ต้องเป๊ะ)


def _estimate_tokens(text: str) -> int:
    """ประมาณจำนวน token คร่าว ๆ (ราว 1 token ต่อ ~3.5 ตัวอักษร) — ใช้อ้างอิงเฉย ๆ"""
    return max(1, round(len(text) / 3.5))


def _hard_split(text: str) -> list[str]:
    """หั่นข้อความยาว ๆ เป็นหน้าต่างขนาด CHUNK_SIZE ที่เหลื่อมกัน CHUNK_OVERLAP"""
    pieces: list[str] = []
    step = CHUNK_SIZE - CHUNK_OVERLAP
    for start in range(0, len(text), step):
        piece = text[start : start + CHUNK_SIZE].strip()
        if piece:
            pieces.append(piece)
        if start + CHUNK_SIZE >= len(text):
            break
    return pieces


def chunk_text(text: str) -> list[Chunk]:
    """
    ตัดข้อความ 1 document → list ของ Chunk

    ขั้นตอน:
      1. แบ่งเป็นย่อหน้าด้วยขึ้นบรรทัด
      2. รวมย่อหน้าเข้าด้วยกันจนใกล้ CHUNK_SIZE แล้วปิดก้อน
      3. ย่อหน้าที่ยาวเกินก้อนเดียว → ส่งไปหั่นแบบ overlap
    """
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    raw_chunks: list[str] = []
    buffer = ""

    def flush() -> None:
        nonlocal buffer
        if buffer.strip():
            raw_chunks.append(buffer.strip())
        buffer = ""

    for para in paragraphs:
        if len(para) > CHUNK_SIZE:
            # ย่อหน้ายาวมาก: ปิดก้อนที่ค้างก่อน แล้วหั่นย่อหน้านี้แยก
            flush()
            raw_chunks.extend(_hard_split(para))
            continue

        if not buffer:
            buffer = para
        elif len(buffer) + 1 + len(para) <= CHUNK_SIZE:
            buffer = f"{buffer}\n{para}"
        else:
            flush()
            buffer = para

    flush()

    return [
        Chunk(index=i, content=c, token_count=_estimate_tokens(c))
        for i, c in enumerate(c for c in raw_chunks if len(c) >= MIN_CHUNK)
    ]
