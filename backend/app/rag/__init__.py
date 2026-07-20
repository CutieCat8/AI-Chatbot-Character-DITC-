"""
rag — โครงสร้างพื้นฐานของ Retrieval-Augmented Generation (T04)

T04 วาง "ฐาน" ของ vector search ให้พร้อม (ยังไม่ใช่ RAG pipeline เต็ม — อันนั้น T10):
    embedding  → แปลงข้อความเป็นเวกเตอร์ (สลับ provider ได้: openai | fake)
    chunking   → ตัด Document เป็นชิ้นเล็ก ๆ ก่อน embed
    indexer    → documents → chunks → embed → เก็บลง document_chunks
    retrieval  → ค้นชิ้นที่ใกล้เคียงด้วย cosine distance ของ pgvector (เบื้องต้น)
    verify     → สคริปต์พิสูจน์ว่า pgvector + embedding + retrieval ทำงานครบ (ดีลิเวอรีของ T04)
"""
from app.rag.embedding import get_embedder

__all__ = ["get_embedder"]
