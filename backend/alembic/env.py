"""
Alembic env.py — เชื่อม migration เข้ากับ model ของเรา

จุดสำคัญ:
  - ดึง DATABASE_URL จาก app.config (ไม่ hardcode ใน alembic.ini)
  - import app.models เพื่อให้ Alembic "มองเห็น" ทุกตาราง แล้ว autogenerate ได้
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.database import Base

# import ทุก model เพื่อลงทะเบียนใน Base.metadata (จำเป็นสำหรับ --autogenerate)
import app.models  # noqa: F401

config = context.config

# ใส่ DB URL จาก settings ตอน runtime
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """สร้าง SQL script โดยไม่ต้องต่อ DB จริง"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """ต่อ DB จริงแล้วรัน migration"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
