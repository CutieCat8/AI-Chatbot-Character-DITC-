"""
benchmark_embeddings.py — เทียบ BGE-M3 vs multilingual-e5-large ก่อนเลือก embedding provider จริง

เหตุผลที่ทำตอนนี้: EMBEDDING_PROVIDER=fake มาตลอด ยังไม่เคย index อะไรจริงเลย เป็นจังหวะเดียวที่
เปลี่ยนได้ฟรีไม่ต้องรื้อ schema — รอจน index จริงแล้วค่อยเปลี่ยนจะแพงกว่ามาก
ทดสอบเฉพาะ 2 ตัวที่รันเองได้ฟรี ไม่ต้องมี API key (ไม่แตะ text-embedding-3-small ตอนนี้ตามที่ตกลง)

วิธีวัด: เอา 20 คำถามที่คาดว่าคนจะถามหน้าตู้จริง (ground truth = เอกสารที่ควรตอบ ดูจาก title จริงใน DB)
เทียบว่า embedding ไหน retrieve เอกสารที่ถูกต้องติด top-3 ได้มากกว่ากัน (recall@3)
วัด latency การ embed ต่อคำถามด้วย เพราะรันบนเครื่องจริงตอน demo ต้องเร็วพอสำหรับ real-time

รัน: cd backend && .venv/Scripts/python -m app.scripts.benchmark_embeddings
ผลลัพธ์ไปที่ backend/benchmark_result.txt
"""
from __future__ import annotations

import time
from pathlib import Path

from sentence_transformers import SentenceTransformer
import numpy as np

from app.database import SessionLocal
from app.models.knowledge import Document, DocumentChunk
from sqlalchemy import select

# 20 คำถามจำลองที่คาดว่าคนจะถามหน้าตู้จริง + เอกสารที่ควรตอบ (ตรวจจาก title จริงใน DB)
# ground truth = คำที่ควรเจอใน title ของเอกสารอันดับต้น ๆ
#
# หลักการเขียน (สำคัญ — แก้จากรอบแรกที่ยังลอกคำจากเอกสารอยู่): ห้ามเอ่ยชื่อย่อหลักสูตร (SE/DII/DTM/...)
# หรือคำที่ตรงกับ title/เนื้อหาเอกสารเป๊ะ ๆ เพราะแบบนั้น keyword search ธรรมดาก็ชนะได้อยู่แล้ว ไม่ได้วัด
# ว่า embedding "เข้าใจความหมาย" จริงไหม ต้องถามแบบคนพูดปกติที่ยังไม่รู้จักชื่อหลักสูตร/ศัพท์ทางการ
# เช่น "อยากเป็นโปรแกรมเมอร์เรียนอะไร" (ไม่พูดคำว่า "วิศวกรรมซอฟต์แวร์" เลย) ไม่ใช่ "หลักสูตรวิศวกรรม
# ซอฟต์แวร์มีอะไรบ้าง" ที่ก็อปคำจาก title มาตรง ๆ
TEST_CASES: list[tuple[str, list[str]]] = [
    ("อยากเป็นโปรแกรมเมอร์ ควรเรียนอะไรดี", ["SE"]),
    ("เรียนจบแล้วอยากทำงานเป็น dev แต่ก็อยากรู้เรื่องธุรกิจด้วย มีสาขาไหนแนะนำ", ["DII"]),
    ("อยากทำงานดูแลระบบไอทีขององค์กรใหญ่ๆ ต้องเรียนสาขาไหน", ["DTM"]),
    ("อยากเป็นที่ปรึกษาด้านการบริหารองค์ความรู้ให้บริษัท เรียนอะไรดี", ["KIM"]),
    ("มีเรียนต่อระดับดอกเตอร์สายนี้ไหม สำหรับคนอยากทำงานด้านบริหารความรู้องค์กร", ["KIM"]),
    ("อยากทำงานเกี่ยวกับระบบสารสนเทศแบบผสมบริหารจัดการ มีสาขาไหนบ้าง", ["MMIT"]),
    ("อยากวาดการ์ตูนเคลื่อนไหวเป็นอาชีพ ต้องเรียนที่ไหนของที่นี่", ["ANI"]),
    ("สนใจงานสายทำ visual effect ให้หนัง ต้องเรียนสาขาอะไร", ["ANI"]),
    ("อยากทำเกมขายเป็นของตัวเอง ต้องเรียนที่ไหน", ["DG"]),
    ("เรียนจบแล้วไปทำงานในบริษัทเกมได้ไหม เรียนสาขาไหนดี", ["DG"]),
    ("ค่าใช้จ่ายต่อเทอมของสาขาที่สอนเขียนโปรแกรมเท่าไหร่", ["SE"]),
    ("ต้องมีคุณสมบัติอะไรถึงจะสมัครสาขาที่เน้นบริหารเทคโนโลยีดิจิทัลได้", ["DTM"]),
    ("อยากคุยกับเจ้าหน้าที่โดยตรง ติดต่อยังไงได้บ้าง", ["ติดต่อเรา"]),
    ("เบอร์โทรของที่นี่คืออะไร", ["ติดต่อเรา"]),
    ("ที่นี่มีสาขาให้เลือกเรียนกี่แบบ", ["หลักสูตร"]),
    ("ขั้นตอนการสมัครเรียนที่ CAMT ทำยังไง", ["หลักสูตร"]),
    ("ดาวน์โหลดเอกสารสมัครเรียนได้ที่ไหน", ["ดาวน์โหลด"]),
    ("ที่นี่มีศูนย์ที่ช่วยพัฒนานวัตกรรมดิจิทัลให้บริษัทภายนอกไหม", ["DITC", "นวัตกรรม"]),
    ("อยากรู้ว่าที่นี่มีหน่วยงานที่ให้คำปรึกษาด้านการจัดการความรู้กับองค์กรอื่นไหม", ["DITC", "KIND"]),
    ("ช่วงนี้มีอะไรใหม่ๆเกิดขึ้นที่นี่บ้าง", ["ข่าว"]),
]

MODELS = {
    "bge-m3": "BAAI/bge-m3",
    "multilingual-e5-large": "intfloat/multilingual-e5-large",
}


def load_chunks() -> list[tuple[str, str]]:
    """คืน [(title, content), ...] ของทุก chunk ที่ active"""
    db = SessionLocal()
    try:
        stmt = (
            select(DocumentChunk.content, Document.title, Document.source_url)
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(Document.is_active.is_(True))
        )
        rows = db.execute(stmt).all()
        return [(r.title or r.source_url, r.content) for r in rows]
    finally:
        db.close()


def evaluate(model_key: str, model_name: str, chunks: list[tuple[str, str]], out: list[str]) -> None:
    out.append(f"\n{'=' * 60}")
    out.append(f"โมเดล: {model_key} ({model_name})")
    out.append("=" * 60)

    t_load = time.time()
    model = SentenceTransformer(model_name)
    out.append(f"โหลดโมเดล: {time.time() - t_load:.1f}s")

    # e5 ต้องมี prefix "passage: "/"query: " ตามสเปคที่โมเดลเทรนมา ไม่ใส่จะแม่นยำลดลงชัดเจน
    # bge-m3 ไม่ต้องใส่ prefix สำหรับ dense retrieval ทั่วไป
    is_e5 = "e5" in model_key
    passage_prefix = "passage: " if is_e5 else ""
    query_prefix = "query: " if is_e5 else ""

    titles = [c[0] for c in chunks]
    texts = [passage_prefix + c[1] for c in chunks]

    t_index = time.time()
    chunk_embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    out.append(f"embed {len(texts)} chunks: {time.time() - t_index:.1f}s")

    hits = 0
    query_latencies = []
    for question, expected_keywords in TEST_CASES:
        t_q = time.time()
        q_emb = model.encode([query_prefix + question], normalize_embeddings=True, show_progress_bar=False)[0]
        query_latencies.append(time.time() - t_q)

        sims = chunk_embeddings @ q_emb
        # จัดอันดับระดับ "เอกสาร" (เอา similarity สูงสุดของแต่ละ title) ไม่ใช่ระดับ chunk
        doc_best: dict[str, float] = {}
        for title, sim in zip(titles, sims):
            if title not in doc_best or sim > doc_best[title]:
                doc_best[title] = float(sim)
        ranked = sorted(doc_best.items(), key=lambda kv: kv[1], reverse=True)[:3]
        top3_titles = [t for t, _ in ranked]

        found = any(
            any(kw in title for title in top3_titles) for kw in expected_keywords
        )
        hits += int(found)
        mark = "✓" if found else "✗"
        out.append(f"  {mark} {question}")
        out.append(f"      top3: {top3_titles}")

    recall = hits / len(TEST_CASES)
    avg_latency = sum(query_latencies) / len(query_latencies)
    out.append(f"\nrecall@3: {hits}/{len(TEST_CASES)} = {recall:.0%}")
    out.append(f"latency เฉลี่ยต่อคำถาม (embed query อย่างเดียว): {avg_latency*1000:.0f}ms")


def main() -> None:
    chunks = load_chunks()
    out: list[str] = [f"จำนวน chunk ที่ใช้ทดสอบ: {len(chunks)}"]
    for key, name in MODELS.items():
        evaluate(key, name, chunks, out)

    result_path = Path(__file__).parent.parent.parent / "benchmark_result.txt"
    result_path.write_text("\n".join(out), encoding="utf-8")
    print(f"done -> {result_path}")


if __name__ == "__main__":
    main()
