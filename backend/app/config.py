"""
config.py — โหลดค่า setting ทั้งหมดจาก environment variable (.env) ที่เดียว

ใช้ pydantic-settings เพื่อ:
  - อ่านค่าจาก .env อัตโนมัติ
  - ตรวจชนิดข้อมูล (type validation) ให้
เรียกใช้ที่อื่นด้วย:  from app.config import settings
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ---- Database ----
    POSTGRES_USER: str = "ditc"
    POSTGRES_PASSWORD: str = "ditc_dev_password"
    POSTGRES_DB: str = "ditc_cat"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432

    # ---- App ----
    APP_ENV: str = "development"
    APP_DEBUG: bool = True
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    # ---- Auth (Sprint 4) ----
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440

    # ---- LLM / AI (Sprint 2 — ยังเลือก provider ได้) ----
    LLM_PROVIDER: str = "claude"
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    LLM_MODEL: str = "claude-sonnet-5"

    # ---- Embedding (RAG) ----
    EMBEDDING_PROVIDER: str = "openai"
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIM: int = 1536

    # ---- Voice (Sprint 2) ----
    STT_PROVIDER: str = "google"
    TTS_PROVIDER: str = "google"

    # ---- Scraper (T03) ----
    SCRAPE_SOURCES: str = "https://ditc.camt.cmu.ac.th,https://camt.cmu.ac.th"
    SCRAPE_INTERVAL_HOURS: int = 24

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # ไม่ error ถ้ามีตัวแปรใน .env ที่ยังไม่ได้ประกาศ
    )

    @property
    def database_url(self) -> str:
        """สร้าง connection string สำหรับ SQLAlchemy (psycopg v3)"""
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def cors_origins_list(self) -> list[str]:
        """แปลง CORS_ORIGINS จาก string คั่นด้วย , เป็น list"""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """cache ไว้ ไม่ต้องอ่าน .env ซ้ำทุกครั้ง"""
    return Settings()


settings = get_settings()
