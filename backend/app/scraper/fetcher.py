"""
fetcher.py — ดาวน์โหลด HTML แต่ละหน้าอย่าง "สุภาพ" ต่อเซิร์ฟเวอร์

หลักการ politeness (มารยาทของ scraper ที่ดี):
  - ส่ง User-Agent บอกว่าเราเป็นใคร (ให้แอดมินเว็บติดต่อได้)
  - เว้นจังหวะ (delay) ระหว่าง request ไม่ยิงรัว
  - เคารพ robots.txt (หน้าไหนห้าม crawl ก็ข้าม)
  - ตั้ง timeout และ retry เบา ๆ กันเน็ตสะดุด
"""
from __future__ import annotations

import asyncio
import logging
from urllib.robotparser import RobotFileParser

import httpx

logger = logging.getLogger("scraper.fetcher")

USER_AGENT = "DITC-CAT-Bot/0.1 (+https://ditc.camt.cmu.ac.th; knowledge-base scraper)"

# นับเฉพาะหน้า HTML เท่านั้น (ข้ามไฟล์ pdf/รูป/zip ฯลฯ)
HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")


class Fetcher:
    """
    ห่อ httpx.AsyncClient ให้ดึงหน้าเว็บอย่างสุภาพ + จำ robots.txt ของแต่ละโดเมน

    ใช้แบบ async context manager:
        async with Fetcher() as f:
            html = await f.get("https://camt.cmu.ac.th")
    """

    def __init__(
        self,
        *,
        delay_seconds: float = 1.0,
        timeout_seconds: float = 20.0,
        max_retries: int = 2,
        respect_robots: bool = True,
    ) -> None:
        self.delay_seconds = delay_seconds
        self.max_retries = max_retries
        self.respect_robots = respect_robots
        self._client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT},
            timeout=timeout_seconds,
            follow_redirects=True,
        )
        # cache robots.txt ต่อโดเมน จะได้ไม่โหลดซ้ำ
        self._robots: dict[str, RobotFileParser | None] = {}

    async def __aenter__(self) -> "Fetcher":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    async def _load_robots(self, origin: str) -> RobotFileParser | None:
        """โหลด robots.txt ของโดเมน (ครั้งเดียวต่อโดเมน). ถ้าโหลดไม่ได้ = อนุญาตหมด"""
        if origin in self._robots:
            return self._robots[origin]

        rp = RobotFileParser()
        try:
            resp = await self._client.get(f"{origin}/robots.txt")
            if resp.status_code == 200:
                rp.parse(resp.text.splitlines())
            else:
                rp = None  # ไม่มี robots.txt → ไม่จำกัด
        except httpx.HTTPError:
            rp = None
        self._robots[origin] = rp
        return rp

    async def allowed(self, url: str) -> bool:
        """เช็กว่า robots.txt อนุญาตให้ดึง url นี้ไหม"""
        if not self.respect_robots:
            return True
        parsed = httpx.URL(url)
        origin = f"{parsed.scheme}://{parsed.host}"
        rp = await self._load_robots(origin)
        if rp is None:
            return True
        return rp.can_fetch(USER_AGENT, url)

    async def get(self, url: str) -> str | None:
        """
        ดึง HTML ของ url (คืน None ถ้าไม่ใช่หน้า HTML / โดน robots ห้าม / error)
        มี retry + เว้นจังหวะ delay หลังยิงทุกครั้ง
        """
        if not await self.allowed(url):
            logger.info("robots.txt ห้าม crawl: %s", url)
            return None

        for attempt in range(self.max_retries + 1):
            try:
                resp = await self._client.get(url)
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "").lower()
                if not any(ct in content_type for ct in HTML_CONTENT_TYPES):
                    logger.debug("ข้าม (ไม่ใช่ HTML): %s [%s]", url, content_type)
                    return None

                return resp.text
            except httpx.HTTPStatusError as e:
                logger.warning("HTTP %s ที่ %s", e.response.status_code, url)
                return None  # 4xx/5xx ไม่ต้อง retry
            except httpx.HTTPError as e:
                if attempt < self.max_retries:
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                logger.warning("ดึงไม่สำเร็จ %s: %s", url, e)
                return None
            finally:
                await asyncio.sleep(self.delay_seconds)  # สุภาพ: เว้นจังหวะทุก request
        return None
