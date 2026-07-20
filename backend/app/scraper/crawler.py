"""
crawler.py — เดินลิงก์ภายในโดเมนแบบ BFS แล้วคืนหน้าเว็บที่ดึงเนื้อหาแล้ว

ขอบเขต (Scope 3.1): scrape เฉพาะ ditc.camt.cmu.ac.th และ camt.cmu.ac.th
กันไม่ให้ crawl ทั้งอินเทอร์เน็ต ด้วยการจำกัด:
  - allowed_domains : ตามลิงก์เฉพาะโดเมนที่อนุญาต
  - max_depth       : ความลึกจากหน้าเริ่มต้น
  - max_pages       : จำนวนหน้าสูงสุดต่อการรัน 1 ครั้ง
  - visited set     : ไม่ดึง URL ซ้ำ
"""
from __future__ import annotations

import logging
from collections import deque
from urllib.parse import urlparse

from app.models.enums import SourceSite
from app.scraper.fetcher import Fetcher
from app.scraper.models import ScrapedPage, detect_language
from app.scraper.parser import extract_links, extract_text

logger = logging.getLogger("scraper.crawler")

# อย่างน้อยต้องมีเนื้อหาเท่านี้ถึงจะเก็บ (กันหน้าเปล่า/หน้า redirect)
MIN_CONTENT_CHARS = 120


def _domain_to_site(host: str) -> SourceSite:
    """map โฮสต์ → enum แหล่งข้อมูล (ditc.* = DITC, ที่เหลือของ camt = CAMT)"""
    return SourceSite.DITC if host.startswith("ditc.") else SourceSite.CAMT


class Crawler:
    def __init__(
        self,
        seeds: list[str],
        *,
        max_depth: int = 2,
        max_pages: int = 100,
        fetcher: Fetcher | None = None,
    ) -> None:
        self.seeds = seeds
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.fetcher = fetcher
        # โดเมนที่อนุญาต = โฮสต์ของ seed ทุกตัว
        self.allowed_domains = {urlparse(s).netloc for s in seeds}

    def _same_scope(self, url: str) -> bool:
        return urlparse(url).netloc in self.allowed_domains

    async def crawl(self) -> list[ScrapedPage]:
        """
        รัน BFS จาก seeds คืน list ของ ScrapedPage (หน้าที่มีเนื้อหาพอ)
        ถ้า caller ไม่ส่ง fetcher มา จะสร้าง/ปิดให้เอง
        """
        own_fetcher = self.fetcher is None
        fetcher = self.fetcher or Fetcher()
        try:
            return await self._run(fetcher)
        finally:
            if own_fetcher:
                await fetcher.__aexit__(None, None, None)

    async def _run(self, fetcher: Fetcher) -> list[ScrapedPage]:
        queue: deque[tuple[str, int]] = deque((s, 0) for s in self.seeds)
        visited: set[str] = set()
        pages: list[ScrapedPage] = []

        # กัน crawl หนีไม่จบ: ถ้าเจอหน้าเนื้อหาน้อย (เก็บไม่ได้) เยอะ ๆ ก็ยังมีเพดานจำนวน "หน้าที่ยิง"
        max_fetches = self.max_pages * 5

        while queue and len(pages) < self.max_pages and len(visited) < max_fetches:
            url, depth = queue.popleft()
            if url in visited or not self._same_scope(url):
                continue
            visited.add(url)

            html = await fetcher.get(url)
            if html is None:
                continue

            title, text = extract_text(html)
            if len(text) >= MIN_CONTENT_CHARS:
                host = urlparse(url).netloc
                pages.append(
                    ScrapedPage(
                        source_site=_domain_to_site(host),
                        source_url=url,
                        title=title,
                        content=text,
                        language=detect_language(text),
                    )
                )
                logger.info("[%d/%d] เก็บแล้ว: %s", len(pages), self.max_pages, url)

            # ตามลิงก์ต่อ ถ้ายังไม่ลึกเกิน
            if depth < self.max_depth:
                for link in extract_links(html, url):
                    if link not in visited and self._same_scope(link):
                        queue.append((link, depth + 1))

        return pages
