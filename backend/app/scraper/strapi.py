"""
strapi.py — ดึงเนื้อหา DITC จาก Strapi CMS (T03)

ทำไมไม่ scrape HTML เหมือน CAMT?
    เว็บ ditc.camt.cmu.ac.th เป็น Next.js SPA — HTML ที่โหลดมามีแค่ "Loading..."
    เนื้อหาจริงถูกดึงด้วย JavaScript จาก Strapi CMS ทีหลัง
    เราจึงดึงตรงจาก Strapi REST API (ได้ JSON สะอาด เหมาะกับ RAG มากกว่า)

⚠️ ข้อควรระวัง — นี่เป็น "INTERNAL API":
    endpoint เหล่านี้ *ไม่ใช่* public API ที่ทีม DITC ประกาศให้ใช้เป็นทางการ
    เราค้นเจอจากการดู network request ตอนหน้าเว็บโหลด (reverse-engineer)
    → โครงสร้าง/ชื่อ endpoint อาจเปลี่ยน/หายไปได้ทุกเมื่อโดยไม่แจ้งล่วงหน้า
    → โค้ดนี้จึงออกแบบให้ "ทน": ถ้า collection ไหนพัง ให้ข้ามแล้วไปต่อ ไม่ล้มทั้งระบบ

Content types ที่ใช้ (ยืนยันแล้วจากเว็บจริง ณ ตอนเขียน):
    infos       → ข่าว/ประกาศ (สำคัญต่อ Idle/Sleep mode ตาม Scope ข้อ 5)
    projects    → โครงการเด่น
    facilities  → สิ่งอำนวยความสะดวก (ห้อง/อุปกรณ์ + ราคา/ติดต่อ)
"""
from __future__ import annotations

import logging

import httpx

from app.config import settings
from app.models.enums import Language, SourceSite
from app.scraper.models import ScrapedPage, detect_language

logger = logging.getLogger("scraper.strapi")

# (api_name, route บนเว็บจริง) — route ใช้ประกอบ source_url ให้ชี้กลับหน้าเว็บที่คนเห็นได้
# ลำดับ = ตามความสำคัญ (ข่าวมาก่อน เพราะใช้ใน Idle/Sleep mode)
COLLECTIONS: list[tuple[str, str]] = [
    ("infos", "news"),
    ("projects", "projects"),
    ("facilities", "facilities"),
]

PAGE_SIZE = 50  # ดึงทีละ 50 รายการ (Strapi จำกัด pageSize สูงสุดปกติ 100)


def flatten_text(node: object) -> str:
    """
    ดึง "ข้อความล้วน" ออกจากโครงสร้าง JSON ซ้อน ๆ ของ Strapi แบบ recursive

    Strapi เก็บเนื้อหาแบบ rich-text เป็น "blocks": list ของ node ที่ซ้อนกันหลายชั้น
    โดยข้อความจริงอยู่ใน key ชื่อ "text" กระจายอยู่ลึก ๆ
    เราจึงเดินเก็บทุกค่า "text" ที่เจอ — วิธีนี้ *ทนต่อการเปลี่ยน schema* เพราะไม่ผูกกับ
    ชื่อ component/field เฉพาะ (ตอบโจทย์ที่ว่า internal API อาจเปลี่ยนได้)
    """
    out: list[str] = []

    def walk(n: object) -> None:
        if isinstance(n, dict):
            for key, value in n.items():
                if key == "text" and isinstance(value, str):
                    out.append(value)
                else:
                    walk(value)
        elif isinstance(n, list):
            for item in n:
                walk(item)

    walk(node)
    return "\n".join(t for t in (s.strip() for s in out) if t)


def _facility_extras(item: dict) -> str:
    """สิ่งอำนวยความสะดวกมี field มีโครงสร้าง (ที่ตั้ง/ราคา/ติดต่อ) — รวมเป็นข้อความอ่านง่าย"""
    parts: list[str] = []
    if item.get("location"):
        parts.append(f"สถานที่: {item['location']}")
    if item.get("price_per_hour") not in (None, ""):
        parts.append(f"ราคาต่อชั่วโมง: {item['price_per_hour']}")
    if item.get("contact_link"):
        parts.append(f"ติดต่อ: {item['contact_link']}")
    return "\n".join(parts)


def _to_page(api_name: str, route: str, item: dict) -> ScrapedPage | None:
    """แปลง 1 รายการจาก Strapi → ScrapedPage (คืน None ถ้าไม่มีเนื้อหาพอ)"""
    title = (item.get("title") or "").strip() or None
    body = flatten_text(item)  # ดึงทุกข้อความจาก rich-text ทุก field ในตัว

    extras = _facility_extras(item) if api_name == "facilities" else ""
    pieces = [p for p in (title, extras, body) if p]
    content = "\n\n".join(pieces).strip()

    if not content:
        return None

    doc_id = item.get("documentId") or item.get("id")
    source_url = f"{settings.DITC_SITE_BASE.rstrip('/')}/{route}/{doc_id}"

    return ScrapedPage(
        source_site=SourceSite.DITC,
        source_url=source_url,
        title=title,
        content=content,
        language=detect_language(content) or Language.TH,
    )


async def _fetch_collection(client: httpx.AsyncClient, api_name: str, route: str) -> list[ScrapedPage]:
    """
    ดึงทุกรายการของ 1 collection (วนหน้าจนหมด) + populate=* เพื่อดึง rich-text/relation มาด้วย
    ห่อ error ไว้ทั้งก้อน: ถ้า collection นี้พัง (เปลี่ยนชื่อ/ล่ม) จะ log แล้วคืน [] ไม่ทำทั้งระบบล้ม
    """
    base = settings.DITC_STRAPI_BASE.rstrip("/")
    pages: list[ScrapedPage] = []
    page = 1
    try:
        while True:
            url = (
                f"{base}/api/{api_name}"
                f"?populate=*&pagination[page]={page}&pagination[pageSize]={PAGE_SIZE}"
            )
            resp = await client.get(url)
            resp.raise_for_status()
            body = resp.json()

            items = body.get("data") or []
            for item in items:
                if not isinstance(item, dict):
                    continue
                sp = _to_page(api_name, route, item)
                if sp is not None:
                    pages.append(sp)

            pagination = (body.get("meta") or {}).get("pagination") or {}
            page_count = pagination.get("pageCount", 1)
            if page >= page_count or not items:
                break
            page += 1

        logger.info("Strapi '%s': ดึงได้ %d รายการ", api_name, len(pages))
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Strapi '%s' ตอบ HTTP %s — ข้าม (endpoint อาจถูกเปลี่ยน/ปิด)",
            api_name, e.response.status_code,
        )
    except (httpx.HTTPError, ValueError, KeyError) as e:
        # ValueError = JSON เพี้ยน, KeyError = โครงสร้างไม่ตรงที่คาด
        logger.warning("Strapi '%s' ดึงไม่สำเร็จ: %s — ข้าม", api_name, e)

    return pages


async def scrape_strapi() -> list[ScrapedPage]:
    """ดึงทุก collection ของ DITC จาก Strapi → รวมเป็น list เดียว (แต่ละ collection ทนพังแยกกัน)"""
    pages: list[ScrapedPage] = []
    headers = {"User-Agent": "DITC-CAT-Bot/0.1 (knowledge-base scraper)"}
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
        for api_name, route in COLLECTIONS:
            pages.extend(await _fetch_collection(client, api_name, route))
    logger.info("Strapi รวมทั้งหมด: %d หน้า", len(pages))
    return pages
