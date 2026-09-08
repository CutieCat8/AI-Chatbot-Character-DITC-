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
  6. (เพิ่ม 2026-09-08, แก้เกณฑ์ 2026-09-09) เกณฑ์ NOISE: session ที่ไม่เคยเรียกทั้ง
     search_camt_knowledge_base **และ** flag_off_topic เลยทั้ง session (ไม่มีคำถามจากคนจริงเลย)
     -> status=NOISE, ข้าม classify ไปเลย (ประหยัด LLM call) — ไม่นับเป็น "จำนวนบทสนทนา" ทั้งใน API
     (routers/stats.py) และ UI (ดู test_stats_api.py) ***เรียก flag_off_topic อย่างเดียว (ไม่เคย
     search) ไม่ใช่ NOISE*** — เป็นคำถามจริงที่นอกขอบเขต ต้องนับเป็นบทสนทนาจริงและส่ง classify ตาม
     ปกติ (แก้จากเกณฑ์เดิมที่กว้างเกินไป ดู test_off_topic_only_session_is_not_noise_...)

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
        tracker.mark_knowledge_search_called()
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
        tracker.mark_knowledge_search_called()
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
    classify_session_topics เลยแม้แต่ครั้งเดียว — ประหยัด LLM call ที่ไม่มีอะไรให้ classify จริง ๆ

    หมายเหตุ: session แบบนี้ (ไม่เรียก mark_knowledge_search_called เลย) ตอนนี้ตกเป็น NOISE ตั้งแต่
    _close_current_session อยู่แล้ว (ดู test_session_without_knowledge_search_call_is_noise ด้านล่าง)
    ทำให้ไม่มีทางไปถึง _classify_and_update's ตัวเช็ค "if not signals: return" ในทางปฏิบัติจริงอีก
    ต่อไป — เทสนี้ยังเก็บไว้เพราะตัวเช็คนั้นยังเป็น defensive guard ที่ถูกต้อง (เช่น เคส query
    เป็นสตริงว่างที่ record_signal ไม่รับ แต่ mark_knowledge_search_called ยังถูกเรียกอยู่)"""
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


def test_session_without_search_or_off_topic_call_is_noise_and_skips_classify(
    monkeypatch: pytest.MonkeyPatch, db
) -> None:
    """เกณฑ์ NOISE (แก้ไขร่วมกับผู้ว่าจ้าง 2026-09-09): session ที่ไม่เคยเรียกทั้ง
    search_camt_knowledge_base และ flag_off_topic เลยทั้ง session (ไม่มีคำถามอะไรจากคนจริงเลย —
    เช่น มีแค่ turn ของแมวพูดทักทาย/บอกว่าไม่เข้าใจ ไม่ใช่ตอบคำถามจริง) ต้องถูกตั้ง status=NOISE
    ตอน insert และ **ห้ามเรียก classify เลย** (ประหยัด LLM call) — ต่างจาก
    test_empty_signals_never_calls_classifier ตรงที่เทสนี้ "มี" สัญญาณอยู่ (จาก transcript) แต่ยัง
    ต้องเป็น NOISE เพราะไม่เคยเรียกทั้งสอง tool เลย"""
    calls: list[list[str]] = []
    monkeypatch.setattr(
        session_tracker_module,
        "classify_session_topics",
        lambda signals: calls.append(list(signals)) or (["tuition_fee"], None),
    )

    async def scenario():
        max_id_before = _max_session_id(db)
        tracker = SessionTracker(f"noise-real-{max_id_before}", silence_timeout_s=60.0)
        tracker.start()
        tracker.record_turn(Speaker.USER)
        tracker.record_signal("ขอโทษค่ะ ไม่เข้าใจที่พูดมาเลย")  # transcript เฉย ๆ ไม่ใช่จาก search/off_topic
        tracker.record_turn(Speaker.BOT)
        # ไม่เรียกทั้ง mark_knowledge_search_called() และ mark_off_topic_flagged() เลยตลอด session นี้
        await tracker.stop(SessionEndReason.UNKNOWN)

        await asyncio.sleep(0.1)
        assert calls == [], "session ที่ไม่เคยเรียก search/flag_off_topic ต้องไม่ถูกส่ง classify เลย"

        db.expire_all()
        row = (
            db.query(ConversationSession)
            .filter(ConversationSession.id > max_id_before)
            .one()
        )
        assert row.status == "noise"
        assert row.tags is None
        assert row.message_count == 2, "แถวยังต้อง insert ปกติ (เห็นจำนวนได้) แค่ status เป็น noise"

    asyncio.run(scenario())


def test_session_with_knowledge_search_call_is_not_noise(monkeypatch: pytest.MonkeyPatch, db) -> None:
    """session ที่เรียก search_camt_knowledge_base อย่างน้อย 1 ครั้ง ต้องไม่ใช่ NOISE (เป็น
    unclassified ตามปกติ รอ classify) แม้จะเรียกแค่ครั้งเดียวท่ามกลาง turn อื่น ๆ ที่ไม่เกี่ยว"""
    monkeypatch.setattr(
        session_tracker_module, "classify_session_topics", lambda signals: (["tuition_fee"], None)
    )

    async def scenario():
        max_id_before = _max_session_id(db)
        tracker = SessionTracker(f"not-noise-{max_id_before}", silence_timeout_s=60.0)
        tracker.start()
        tracker.record_turn(Speaker.USER)
        tracker.record_signal("ค่าเทอม SE")
        tracker.mark_knowledge_search_called()
        tracker.record_turn(Speaker.BOT)
        await tracker.stop(SessionEndReason.UNKNOWN)

        await asyncio.sleep(0.1)
        db.expire_all()
        row = (
            db.query(ConversationSession)
            .filter(ConversationSession.id > max_id_before)
            .one()
        )
        assert row.status == "unclassified"
        assert row.tags == ["tuition_fee"]

    asyncio.run(scenario())


def test_off_topic_only_session_is_not_noise_and_still_gets_classified(
    monkeypatch: pytest.MonkeyPatch, db
) -> None:
    """เจตนาของเกณฑ์ใหม่ (แก้ 2026-09-09) — session ที่เรียก flag_off_topic แต่ไม่เคยเรียก search
    เลย (คนถามนอกขอบเขต CAMT/DITC ล้วน ๆ เช่น ถามเรื่องอากาศ) ต้อง **ไม่ใช่ NOISE**: เป็นคำถามจริง
    จากคนจริง ต้องนับเป็นบทสนทนาจริงและถูกส่ง classify ตามปกติ (จะได้ tag ที่เหมาะสมหรือ "other"
    ก็แล้วแต่ classifier) — เหตุผล: ถ้าคนถามนอกเรื่องเยอะ ต้องเห็นตัวเลขนี้ในแดชบอร์ด เพราะแปลว่า
    คนไม่รู้ว่าตู้ตอบอะไรได้ เป็นปัญหา UX ไม่ใช่ข้อมูลที่ควรทิ้ง"""
    calls: list[list[str]] = []
    monkeypatch.setattr(
        session_tracker_module,
        "classify_session_topics",
        lambda signals: calls.append(list(signals)) or (["other"], "ถามเรื่องนอกขอบเขต"),
    )

    async def scenario():
        max_id_before = _max_session_id(db)
        tracker = SessionTracker(f"off-topic-only-{max_id_before}", silence_timeout_s=60.0)
        tracker.start()
        tracker.record_turn(Speaker.USER)
        tracker.record_signal("อากาศวันนี้เป็นยังไงบ้าง")  # จาก flag_off_topic
        tracker.mark_off_topic_flagged()
        # ไม่เรียก tracker.mark_knowledge_search_called() เลย — ไม่เคย search จริง
        tracker.record_turn(Speaker.BOT)
        await tracker.stop(SessionEndReason.UNKNOWN)

        await asyncio.sleep(0.1)
        assert calls != [], "off-topic-only session ต้องถูกส่ง classify ตามปกติ ไม่ข้ามเหมือน NOISE"

        db.expire_all()
        row = (
            db.query(ConversationSession)
            .filter(ConversationSession.id > max_id_before)
            .one()
        )
        assert row.status != "noise", "เรียก flag_off_topic แล้วต้องไม่ใช่ NOISE"
        assert row.status == "unclassified"
        assert row.tags == ["other"]

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


def test_mark_knowledge_search_called_only_at_the_search_tool_site() -> None:
    """Structural guard — mark_knowledge_search_called() ต้องถูกเรียกแค่ 1 จุดเท่านั้น: จุดที่จัดการ
    search_camt_knowledge_base tool call ห้ามถูกเรียกจาก flag_off_topic branch เด็ดขาด (ถ้าเผลอเรียก
    ที่นั่นด้วย session ที่ถามนอกเรื่องอย่างเดียวจะถูกนับ "เรียก search" ผิด ๆ ทั้งที่ไม่เคยเรียกจริง)"""
    import inspect

    source = inspect.getsource(voice_module)
    assert source.count(".mark_knowledge_search_called()") == 1, (
        "mark_knowledge_search_called() ต้องถูกเรียกแค่จุดเดียว (ตอนจัดการ search_camt_knowledge_base)"
    )

    off_topic_branch_start = source.index('if fc.name == "flag_off_topic":')
    off_topic_branch_end = source.index("continue", off_topic_branch_start)
    off_topic_branch = source[off_topic_branch_start:off_topic_branch_end]
    assert "mark_knowledge_search_called" not in off_topic_branch, (
        "ห้ามเรียก mark_knowledge_search_called() จาก flag_off_topic branch"
    )
    assert "mark_off_topic_flagged" in off_topic_branch, (
        "flag_off_topic branch ต้องเรียก mark_off_topic_flagged() ด้วย ไม่งั้น off-topic-only "
        "session จะถูกนับเป็น NOISE ผิด ๆ (เกณฑ์ใหม่ 2026-09-09: off-topic ไม่ใช่ NOISE)"
    )


def test_mark_off_topic_flagged_only_at_the_flag_off_topic_site() -> None:
    """Structural guard — mark_off_topic_flagged() ต้องถูกเรียกแค่ 1 จุด (ใน flag_off_topic branch)
    ห้ามถูกเรียกจากจุดจัดการ search_camt_knowledge_base เด็ดขาด (ถ้าเผลอเรียกที่นั่นด้วยจะไม่กระทบ
    ความถูกต้องของ NOISE โดยตรง แต่ผิดเจตนา — mark_off_topic_flagged มีไว้แทน "ถามนอกเรื่อง"
    เท่านั้น)"""
    import inspect

    source = inspect.getsource(voice_module)
    assert source.count(".mark_off_topic_flagged()") == 1, (
        "mark_off_topic_flagged() ต้องถูกเรียกแค่จุดเดียว (ใน flag_off_topic branch เท่านั้น)"
    )
