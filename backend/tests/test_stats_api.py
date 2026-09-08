"""
test_stats_api.py — พิสูจน์ requirement ของ Conversation Stats API (ก้อนที่ 4, 2026-09-08):

  1. auth ต้องคุ้มกันจริง (ต่างจาก documents.py/chat.py ที่ยังเปิดโล่งอยู่)
  2. รองรับเลือกช่วงวันที่ได้จริง ไม่ hardcode 7 วัน — start/end เป็น required param ไม่มี default
  3. NOISE ไม่รวมใน total_conversations/daily_counts เลย นับแยกต่างหาก
  4. unclassified (tags IS NULL) นับแยกจาก other (มี tag "other") ไม่ปนกัน
  5. daily_counts เติมวันที่ไม่มีบทสนทนาด้วย 0 (ไม่ข้ามวัน)

ใช้ DB จริงของ dev container — seed ConversationSession ตรง ๆ ไม่ผ่าน session_tracker (เทสนี้ไม่ได้
ทดสอบ session_tracker.py ซ้ำ แค่ทดสอบ query/aggregation ของ stats API เอง)

รัน: docker exec ditc_backend python -m pytest tests/test_stats_api.py -v
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.models import ConversationSession
from app.models.admin import AdminUser
from app.models.enums import AdminRole, Language, SessionEndReason, SessionStatus
from app.routers import stats as stats_module
from app.routers.auth import get_current_admin


def _utc(y: int, m: int, d: int, hour: int = 12) -> datetime:
    return datetime(y, m, d, hour, 0, 0, tzinfo=timezone.utc)


def _make_session(
    db,
    started_at: datetime,
    tags: list[str] | None = None,
    status: SessionStatus = SessionStatus.UNCLASSIFIED,
) -> None:
    db.add(
        ConversationSession(
            started_at=started_at,
            ended_at=started_at,
            language=Language.TH,
            tags=tags,
            other_hint=None,
            message_count=2,
            status=status,
            end_reason=SessionEndReason.UNKNOWN,
        )
    )


def _build_app_with_fake_admin() -> FastAPI:
    """ข้าม JWT จริง — override get_current_admin ตรง ๆ (เทสนี้ทดสอบ query/aggregation ไม่ใช่ auth
    เอง ดู test_requires_authentication ที่ทดสอบ auth จริงแยกต่างหากโดยไม่ override ตัวนี้)"""
    app = FastAPI()
    app.include_router(stats_module.router)
    app.dependency_overrides[get_current_admin] = lambda: AdminUser(
        id=1, email="test@ditc.local", hashed_password="x", role=AdminRole.ADMIN
    )
    return app


@pytest.fixture()
def db():
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _clear_conversation_sessions(db):
    """เทสนี้ seed ConversationSession ตรง ๆ ต้องล้างก่อน/หลังกันปนกับเทสไฟล์อื่นที่รันในโปรเซสเดียวกัน"""
    db.query(ConversationSession).delete()
    db.commit()
    yield
    db.query(ConversationSession).delete()
    db.commit()


def test_requires_authentication() -> None:
    """ต่างจาก documents.py/chat.py — endpoint นี้ต้องปฏิเสธ request ที่ไม่มี Authorization header"""
    app = FastAPI()
    app.include_router(stats_module.router)  # ไม่ override get_current_admin — ใช้ของจริง
    client = TestClient(app)
    resp = client.get("/api/stats/conversations", params={"start": "2026-09-01", "end": "2026-09-07"})
    assert resp.status_code == 401


def test_missing_date_params_returns_422() -> None:
    """start/end ต้องระบุเสมอ ไม่มี default hardcode (เช่น 7 วันย้อนหลัง)"""
    app = _build_app_with_fake_admin()
    client = TestClient(app)
    resp = client.get("/api/stats/conversations")
    assert resp.status_code == 422


def test_start_after_end_returns_422() -> None:
    app = _build_app_with_fake_admin()
    client = TestClient(app)
    resp = client.get(
        "/api/stats/conversations", params={"start": "2026-09-10", "end": "2026-09-01"}
    )
    assert resp.status_code == 422


def test_daily_counts_topics_noise_and_unclassified_split_correctly(db) -> None:
    _make_session(db, _utc(2026, 9, 1), tags=["tuition_fee"])
    _make_session(db, _utc(2026, 9, 1), tags=["tuition_fee", "admission"])
    _make_session(db, _utc(2026, 9, 2), tags=None)  # ยัง unclassified (classify ไม่สำเร็จ/ยังไม่จบ)
    _make_session(db, _utc(2026, 9, 2), tags=["other"], status=SessionStatus.UNCLASSIFIED)
    _make_session(db, _utc(2026, 9, 2), tags=["other", "curriculum_se"])
    _make_session(db, _utc(2026, 9, 3), tags=["curriculum_se"], status=SessionStatus.NOISE)
    db.commit()

    app = _build_app_with_fake_admin()
    client = TestClient(app)
    resp = client.get(
        "/api/stats/conversations", params={"start": "2026-09-01", "end": "2026-09-04"}
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["start_date"] == "2026-09-01"
    assert body["end_date"] == "2026-09-04"

    # 6 แถวทั้งหมด แต่ 1 แถวเป็น NOISE ต้องไม่นับใน total_conversations
    assert body["total_conversations"] == 5
    assert body["noise_count"] == 1

    # 1 แถว tags=None (2026-09-02) → unclassified_count = 1 (ไม่รวม noise ที่ tags ไม่ None)
    assert body["unclassified_count"] == 1
    # 2 แถวมี tag "other" (ทั้งคู่วันที่ 2026-09-02) → other_count = 2 (ไม่ปนกับ unclassified)
    assert body["other_count"] == 2

    # daily_counts ต้องมีครบทุกวันในช่วง (1-4 ก.ย.) แม้วันที่ 4 ไม่มีข้อมูลเลย = 0 ไม่ใช่ข้ามไป
    daily = {row["date"]: row["count"] for row in body["daily_counts"]}
    assert daily == {
        "2026-09-01": 2,
        "2026-09-02": 3,
        "2026-09-03": 0,  # แถวเดียววันนี้เป็น NOISE — ไม่นับ
        "2026-09-04": 0,
    }

    topics = {row["topic"]: row["count"] for row in body["top_topics"]}
    assert topics == {"tuition_fee": 2, "admission": 1, "other": 2, "curriculum_se": 1}
    # top_topics ต้องมี label ภาษาไทยติดมาด้วย ไม่ใช่แค่ enum key ดิบ ๆ
    assert all(row["label"] for row in body["top_topics"])


def test_date_range_excludes_sessions_outside_range(db) -> None:
    _make_session(db, _utc(2026, 8, 31, hour=23), tags=["tuition_fee"])  # ก่อนช่วงที่เลือก
    _make_session(db, _utc(2026, 9, 5, hour=1), tags=["tuition_fee"])  # หลังช่วงที่เลือก
    _make_session(db, _utc(2026, 9, 2), tags=["tuition_fee"])  # อยู่ในช่วง
    db.commit()

    app = _build_app_with_fake_admin()
    client = TestClient(app)
    resp = client.get(
        "/api/stats/conversations", params={"start": "2026-09-01", "end": "2026-09-03"}
    )
    body = resp.json()
    assert body["total_conversations"] == 1
