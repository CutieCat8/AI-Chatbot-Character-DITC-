"""
parser.py — แยก "หัวข้อ + เนื้อหาหลัก" ออกจาก HTML และหาลิงก์ภายในโดเมน

เป้าหมาย: ได้ข้อความสะอาด ๆ (ไม่มีเมนู/ฟุตเตอร์/สคริปต์) เพื่อเอาไปทำ embedding
ใช้ BeautifulSoup + lxml. เป็น heuristic ง่าย ๆ พอสำหรับ scrape ครั้งแรก (T03)
"""
from __future__ import annotations

from urllib.parse import urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup

# แท็กที่ไม่ใช่เนื้อหา — ตัดทิ้งก่อนดึงข้อความ
_NOISE_TAGS = ["script", "style", "noscript", "nav", "header", "footer", "form", "svg"]

# นามสกุลไฟล์ที่ไม่ใช่หน้า HTML — ไม่ต้องตามลิงก์ไป
_SKIP_EXTENSIONS = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
    ".zip", ".rar", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".mp4", ".mp3", ".css", ".js", ".json", ".xml",
)


def extract_title(soup: BeautifulSoup) -> str | None:
    """หาหัวข้อหน้า: ใช้ <h1> ก่อน ถ้าไม่มีค่อยใช้ <title>"""
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        return h1.get_text(strip=True)
    if soup.title and soup.title.get_text(strip=True):
        return soup.title.get_text(strip=True)
    return None


def extract_text(html: str) -> tuple[str | None, str]:
    """
    คืน (title, clean_text) จาก HTML
    - ตัดแท็ก noise (script/nav/footer ฯลฯ) ออกก่อน
    - รวมข้อความจาก <main>/<article> ถ้ามี ไม่งั้นใช้ <body>
    - ยุบช่องว่าง/บรรทัดว่างซ้ำ ๆ ให้เรียบ
    """
    soup = BeautifulSoup(html, "lxml")
    title = extract_title(soup)

    for tag in soup(_NOISE_TAGS):
        tag.decompose()

    # เนื้อหาหลักมักอยู่ใน <main> หรือ <article> — ถ้าไม่มีก็ใช้ทั้ง body
    root = soup.find("main") or soup.find("article") or soup.body or soup

    lines = [line.strip() for line in root.get_text("\n").splitlines()]
    clean = "\n".join(line for line in lines if line)  # ทิ้งบรรทัดว่าง
    return title, clean


def extract_links(html: str, base_url: str) -> set[str]:
    """
    ดึงลิงก์ทั้งหมดในหน้า → แปลงเป็น URL เต็ม + ตัด fragment (#...) ทิ้ง
    คืนเฉพาะลิงก์ http(s) ที่ไม่ใช่ไฟล์ดาวน์โหลด (การกรอง "โดเมนเดียวกัน" ทำที่ crawler)
    """
    soup = BeautifulSoup(html, "lxml")
    links: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        absolute, _ = urldefrag(urljoin(base_url, href))
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if parsed.path.lower().endswith(_SKIP_EXTENSIONS):
            continue
        links.add(absolute)
    return links
