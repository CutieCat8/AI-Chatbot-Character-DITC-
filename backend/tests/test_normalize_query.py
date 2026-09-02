"""
test_normalize_query.py — เทส DITC alias normalization

เจอบั๊กจริงตอนทดสอบ Live API: "DITC" ถูก STT ถอดเสียงเป็น "ITC" (หาย D ตัวแรก)
เทสนี้ครอบกันไม่ให้กลับมาพังอีกตอนแก้โค้ดในอนาคต (ทั้ง 2 บั๊กที่เจอจริง: ตัดพลาดคำในคำอังกฤษอื่น
เช่น "stitch", และภาษาไทยไม่มีช่องว่างคั่นคำทำให้ boundary regex เดิมพลาด)

รัน: cd backend && .venv/Scripts/python -m pytest tests/test_normalize_query.py -v
"""
from app.rag.retrieval import normalize_query


def test_itc_with_space_becomes_ditc():
    assert normalize_query("ศูนย์ ITC ทำอะไรบ้าง") == "ศูนย์ DITC ทำอะไรบ้าง"


def test_itc_glued_to_thai_word_becomes_ditc():
    # ภาษาไทยไม่มีช่องว่างคั่นคำ — "ITC" ติดกับคำไทยทันทีก็ต้องจับได้
    assert normalize_query("ITCตั้งอยู่ที่ไหน") == "DITCตั้งอยู่ที่ไหน"


def test_existing_ditc_untouched():
    # "DITC" มี "ITC" เป็น substring อยู่แล้ว — ต้องไม่ถูกแก้ซ้ำเป็น "DDITC" หรือพัง
    assert normalize_query("CAMT กับ DITC ต่างกันยังไง") == "CAMT กับ DITC ต่างกันยังไง"


def test_itc_inside_english_word_not_touched():
    # กันคำอังกฤษอื่นที่บังเอิญมี "itc" อยู่ข้างใน (เช่น stitch, kitchen) ไม่ให้โดนแก้มั่ว
    assert normalize_query("stitch ผ้า") == "stitch ผ้า"
    assert normalize_query("kitchen table") == "kitchen table"


def test_thai_phonetic_aliases():
    assert "DITC" in normalize_query("สนใจดิติซีมากครับ")
    assert "DITC" in normalize_query("ดีไอทีซีทำอะไรบ้าง")
    assert "DITC" in normalize_query("อยากรู้จักดีติซี")
    assert "DITC" in normalize_query("ดิทซีอยู่ตรงไหน")


def test_case_with_no_ditc_mention_untouched():
    assert normalize_query("ค่าเทอมสาขา SE เท่าไหร่") == "ค่าเทอมสาขา SE เท่าไหร่"
