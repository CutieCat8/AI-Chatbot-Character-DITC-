"""
test_session_tracker_classify.py — พิสูจน์การเชื่อม SessionTracker <-> topic_classifier (ก้อนที่ 3,
2026-09-08). ทดสอบตรง SessionTracker แบบ pure-asyncio ไม่ผ่าน WS/thread เลย (เหมือน
test_session_tracker_watchdog_ignores_everything_except_record_turn ใน test_session_tracker.py —
deterministic กว่ามาก ไม่เจอปัญหา thread-bridging ที่เจอตอนทำ WS-level test ของก้อนก่อน)

ครอบคลุมสิ่งที่ผู้ว่าจ้างสั่งให้พิสูจน์:
  1. classify เป็น background task จริง — insert แถวเสร็จ (เห็นได้ทันที) โดยไม่รอ classify เลย
  2. classify สำเร็จ -> UPDATE tags/other_hint ทีหลัง
  3. classify ล้มเหลว (raise exception) -> แถวไม่หาย ยังเป็น UNCLASSIFIED/tags=None
  4. session ไม่มีสัญญาณเลย -> ไม่เรียก classify เลย (ประหยัด LLM call)
  5. structural guard: record_signal() ถูกเรียกแค่ 3 จุดตามที่ตั้งใจ (topic/query/bot transcript)
     ไม่มีจุดไหนใช้ input_audio_transcription (คำพูดดิบผู้ใช้) เลย

รัน: docker exec ditc_backend python -m pytest tests/test_session_tracker_classify.py -v
"""
from __future__ import annotations

import asyncio
import time

import pytest

from app.database import SessionLocal
from app.models import ConversationSession
from app.models.enums import SessionEndReason, Speaker
from app.routers import voice as voice_module
from app.services import session_tracker as session_tracker_module
from app.services.session_tracker import SessionTracker


def _max_session_id(db) -> int:
    from sqlalchemy import func

    return db.query(func.max(ConversationSession.id)).scalar() or 0


@pytest.fixture()
def db():
    session = SessionLocal()
    yield session
    session.close()


def test_close_session_does_not_wait_for_classify(monkeypatch: pytest.MonkeyPatch, db) -> None:
    """stop() (ปิด session) ต้อง insert แถวเสร็จโดยไม่รอ classify เลย แม้ classify จะช้า"""
    calls: list[list[str]] = []

    def fake_classify(signals: list[str]):
        calls.append(list(signals))
        time.sleep(0.1)  # จำลอง network latency จริงของ LLM call (sync เพราะรันใน executor จริง)
        return (["tuition_fee"], None)

    monkeypatch.setattr(session_tracker_module, "classify_session_topics", fake_classify)

    async def scenario():
        max_id_before = _max_session_id(db)
        tracker = SessionTracker(f"classify-test-{max_id_before}", silence_timeout_s=60.0)
        tracker.start()
        tracker.record_turn(Speaker.USER)
        tracker.record_signal("ค่าเทอม SE เท่าไหร่")
        tracker.record_turn(Speaker.BOT)

        t0 = time.monotonic()
        await tracker.stop(SessionEndReason.UNKNOWN)
        stop_duration = time.monotonic() - t0
        assert stop_duration < 0.05, (
            f"stop() ใช้เวลา {stop_duration:.3f}s — ไม่ควรรอ classify (0.1s) เลยเพราะเป็น "
            "background task แยกต่างหาก"
        )

        db.expire_all()
        row = (
            db.query(ConversationSession)
            .filter(ConversationSession.id > max_id_before)
            .one()
        )
        assert row.status == "unclassified"
        assert row.tags is None, "classify (background) ยังไม่มีเวลาทำงานจบตอนนี้"

        await asyncio.sleep(0.3)  # ให้ background task (0.1s) มีเวลาทำจบ
        db.expire_all()
        db.refresh(row)
        assert row.tags == ["tuition_fee"]
        assert calls == [["ค่าเทอม SE เท่าไหร่"]]

    asyncio.run(scenario())


def test_classify_failure_does_not_lose_the_session(monkeypatch: pytest.MonkeyPatch, db) -> None:
    """classify raise exception -> แถวต้องยังอยู่ (insert ไปแล้วก่อนหน้า) เป็น UNCLASSIFIED/tags=None
    ไม่ retry ไม่ crash อะไรที่กระทบ voice_ws()"""

    def failing_classify(signals: list[str]):
        raise ConnectionError("จำลอง DeepSeek ล่ม")

    monkeypatch.setattr(session_tracker_module, "classify_session_topics", failing_classify)

    async def scenario():
        max_id_before = _max_session_id(db)
        tracker = SessionTracker(f"classify-fail-{max_id_before}", silence_timeout_s=60.0)
        tracker.start()
        tracker.record_turn(Speaker.USER)
        tracker.record_signal("คำถามอะไรสักอย่าง")
        tracker.record_turn(Speaker.BOT)
        await tracker.stop(SessionEndReason.UNKNOWN)

        await asyncio.sleep(0.1)  # ให้ background task มีเวลาล้มเหลวให้จบ
        db.expire_all()
        row = (
            db.query(ConversationSession)
            .filter(ConversationSession.id > max_id_before)
            .one()
        )
        assert row.status == "unclassified"
        assert row.tags is None
        assert row.message_count == 2, "แถว/message_count ต้องยังอยู่ครบ ไม่หายไปเพราะ classify พัง"

    asyncio.run(scenario())


def test_empty_signals_never_calls_classifier(monkeypatch: pytest.MonkeyPatch, db) -> None:
    """session ที่ไม่มี record_signal() เลย (ไม่เรียก tool, ไม่มี transcript) ต้องไม่เรียก
    classify_session_topics เลยแม้แต่ครั้งเดียว — ประหยัด LLM call ที่ไม่มีอะไรให้ classify จริง ๆ"""
    calls: list[list[str]] = []
    monkeypatch.setattr(
        session_tracker_module, "classify_session_topics", lambda signals: calls.append(list(signals))
    )

    async def scenario():
        max_id_before = _max_session_id(db)
        tracker = SessionTracker(f"classify-empty-{max_id_before}", silence_timeout_s=60.0)
        tracker.start()
        tracker.record_turn(Speaker.USER)
        tracker.record_turn(Speaker.BOT)
        await tracker.stop(SessionEndReason.UNKNOWN)

        await asyncio.sleep(0.05)
        assert calls == [], "ไม่ควรเรียก classify เลยถ้าไม่มีสัญญาณอะไรสะสมไว้"

        db.expire_all()
        row = (
            db.query(ConversationSession)
            .filter(ConversationSession.id > max_id_before)
            .one()
        )
        assert row.tags is None

    asyncio.run(scenario())


def test_record_signal_called_only_at_the_three_intended_sites() -> None:
    """Structural guard — record_signal() ต้องถูกเรียกแค่ 3 จุดตามที่ตั้งใจ (query ของ
    search_camt_knowledge_base, topic ของ flag_off_topic, bot output_transcription) และห้ามมีจุด
    ไหนส่ง input_audio_transcription (คำพูดดิบของผู้ใช้) เข้าไปเด็ดขาด — ตัดสินใจร่วมกับผู้ว่าจ้าง
    ไว้ชัดเจนว่าไม่ยอมเสี่ยง PDPA เกินจำเป็นแม้จะเก็บแค่ใน memory ชั่วคราวก็ตาม"""
    import inspect
    import re

    source = inspect.getsource(voice_module)
    call_args = re.findall(r"\.record_signal\((\w+)\)", source)
    assert set(call_args) == {"topic", "q", "text_piece"}, (
        f"คาดว่า record_signal ถูกเรียกด้วย topic/q/text_piece เท่านั้น แต่เจอ {call_args}"
    )
    assert len(call_args) == 3, f"คาดว่า record_signal( ถูกเรียกแค่ 3 จุด แต่เจอ {len(call_args)}"
    assert "input_audio_transcription" not in "".join(call_args), (
        "record_signal ห้ามรับ input_audio_transcription (คำพูดดิบผู้ใช้) เด็ดขาด"
    )
