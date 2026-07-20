"""
scraper — โมดูลดึงเนื้อหาเว็บ DITC / CAMT เข้า Knowledge Base (T03)

ลำดับการทำงาน (pipeline):
    fetcher   → ดาวน์โหลด HTML แต่ละหน้า (async, สุภาพต่อเซิร์ฟเวอร์)
    parser    → แยก "หัวข้อ + เนื้อหาหลัก" ออกจาก HTML และหาลิงก์ภายในโดเมน
    crawler   → เดินลิงก์ภายในโดเมนแบบ BFS จำกัดความลึก/จำนวนหน้า
    persist   → บันทึกลงตาราง documents (หรือ dump เป็น JSON ตอนยังไม่มี DB)

เรียกใช้จาก CLI:  python -m app.scraper.run --help
"""
from app.scraper.models import ScrapedPage, compute_content_hash

__all__ = ["ScrapedPage", "compute_content_hash"]
