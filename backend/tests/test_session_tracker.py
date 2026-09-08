"""
test_session_tracker.py — พิสูจน์ requirement ที่ผู้ว่าจ้างสั่งห้ามพังตอนเพิ่ม session tracker
(ก้อนที่ 2 ของงานสถิติหัวข้อบทสนทนา, 2026-09-08):

  1. GoAway reconnect กลาง session ต้องไม่ถูกนับเป็น session จบ/session ใหม่
     -> พิสูจน์ด้วย structural guard (test_goaway_...) + unit test ตรง SessionTracker (test_session_
     tracker_watchdog_...) ไม่ผ่าน WS/thread เลย — ตอนแรกลองทำเป็นเทสระดับ WS ที่บังคับ GoAway จริง
     ผ่าน FakeSession queue-based แล้วเจอว่า "cancel task ที่ค้างอยู่ใน queue.get() ของ thread pool
     worker ไม่ได้หยุด thread จริง ๆ" ทำให้ thread pool รั่วสะสมจนทั้งไฟล์ค้าง (เจอจริงตอนรันซ้ำหลายรอบ)
     เปลี่ยนมาทดสอบ SessionTracker ตรง ๆ แทนเพราะ deterministic กว่ามากและพิสูจน์ guarantee เดียวกัน
  2. เงียบครบ BACKEND_SESSION_SILENCE_TIMEOUT_S แล้วต้องปิด analytics session จริง (insert DB)
     -> พิสูจน์ในเทส unit เดียวกับข้อ 1 (test_session_tracker_watchdog_...)
  3. คุยต่อหลังปิด session แล้วต้องเริ่มนับ session ใหม่ถูกต้อง (แถวที่ 2 แยกจากแถวแรก)
     -> พิสูจน์ในเทส unit เดียวกับข้อ 1
  4. WS หลุดกลางคัน (client ปิดเอง) ต้อง flush session ที่เปิดค้างอยู่ ไม่ค้างไม่มีวันจบ
     -> test_ws_disconnect_flushes_open_session_without_waiting_for_timeout (ผ่าน WS จริง)
  5. flag_off_topic ต้องยังทำงานเหมือนเดิมทุกประการ ไม่ถูกกระทบจาก hook ที่เพิ่มเข้าไป
     -> test_flag_off_topic_still_works_unaffected_by_session_tracker (ผ่าน WS จริง)

หมายเหตุ: เทสนี้ทำ FakeSession/make_response ของตัวเอง (ไม่ reuse จาก test_voice_ws_multiturn.py)
เพราะเทสนั้น "ไม่ตั้ง session_resumption_update/go_away ให้ response object" — ตรวจแล้วว่า **พังอยู่
ก่อนแล้ว** (AttributeError) จากตอนที่เพิ่ม session resumption reconnect (commit 90f38cb) ไม่เกี่ยวกับ
งานก้อนนี้เลย ไม่ได้แก้ในนี้เพราะอยู่นอกสโคปที่สั่ง (ดูรายงานท้าย session)

รัน: docker exec ditc_backend python -m pytest tests/test_session_tracker.py -v
ใช้ DB จริงของ dev container (conversation_sessions/conversation_turns) — ไม่ mock DB
"""
from __future__ import annotations

import asyncio
import json
import queue as _queue
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func

from app.database import SessionLocal
from app.models import ConversationSession, ConversationTurn
from app.models.enums import SessionEndReason, Speaker
from app.routers import voice as voice_module


def make_response(
    data: bytes | None = None,
    transcript: str | None = None,
    turn_complete: bool = False,
    tool_call=None,
    go_away=None,
    session_resumption_update=None,
):
    server_content = SimpleNamespace(
        output_transcription=SimpleNamespace(text=transcript) if transcript else None,
        turn_complete=turn_complete,
    )
    return SimpleNamespace(
        tool_call=tool_call,
        data=data,
        server_content=server_content,
        go_away=go_away,
        session_resumption_update=session_resumption_update,
    )


def make_tool_call_response(name: str, args: dict, call_id: str = "call-1"):
    fc = SimpleNamespace(id=call_id, name=name, args=args)
    return make_response(tool_call=SimpleNamespace(function_calls=[fc]))


def make_go_away_response(time_left: str = "60s"):
    return make_response(go_away=SimpleNamespace(time_left=time_left))


_END_OF_TURN = object()  # sentinel เฉพาะเทสนี้ — บอก receive() ว่าจบ 1 เทิร์นแล้ว (ไม่ใช่ response จริง)


class FakeSession:
    """เหมือน session.receive() ของ SDK จริง (แต่ละครั้งที่เรียกคืนแค่ 1 เทิร์นแล้วจบตัวเอง) แต่ขับ
    ด้วยคิวที่เทสสั่ง push_turn()/push_go_away() เองได้ทีละจังหวะ — จำเป็นเพราะเทสนี้ต้องคุมเวลาที่
    response แต่ละก้อนมาถึงจริง ๆ (ทดสอบ silence timeout/GoAway ต้องมีช่องว่างเวลาระหว่างเทิร์นที่
    คุมได้ ถ้าใช้ลิสต์ตายตัวแบบ test_voice_ws_multiturn.py ทุกเทิร์นจะถูก consume รัวติดกันทันทีไม่รอ
    client เลย เจอบั๊กนี้จริงตอนเขียนเทสรอบแรก — message_count เพี้ยนเพราะเทิร์น 2 ถูกส่งไปแล้วก่อนที่
    เทสจะทันส่ง speech_start ตัวที่ 2 ด้วยซ้ำ)

    push_turn()/push_go_away() ถูกเรียกจากเทรดของเทส (pytest) แต่ receive() รันในเทรดของแอป (Starlette
    TestClient รัน ASGI app ในเทรดแยก) — ข้ามเทรดแบบนี้ต้องใช้ loop.call_soon_threadsafe() เท่านั้น
    (API ข้ามเทรดที่ asyncio รับประกันความปลอดภัยโดยตรง) ลองมาแล้ว 2 วิธีก่อนหน้านี้ที่ผิด:
      1. asyncio.Queue().put_nowait() ตรง ๆ ข้ามเทรด — ไม่ thread-safe จริง ๆ (get() ฝั่งแอปไม่เคย
         ถูกปลุก เทสค้าง timeout)
      2. queue.Queue (thread-safe) + loop.run_in_executor() ฝั่งอ่าน — thread-safe ก็จริง แต่ asyncio
         cancel() หยุด thread ที่ blocking อยู่ใน q.get() จริง ๆ ไม่ได้ ทำให้ thread ของ default
         executor pool รั่วสะสม ชนกับ thread pool ที่ TestClient เองก็ใช้อยู่ภายใน จนเดตล็อกทั้งกระบวนการ
         (เจอจริง: แม้รันทีละเทสเดี่ยว ๆ ก็ยังค้างได้แบบสุ่ม)
    call_soon_threadsafe() ไม่ใช้ thread/executor เลย จึงไม่มีปัญหาทั้งสองข้อนี้"""

    def __init__(self) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()
        self._loop: asyncio.AbstractEventLoop | None = None  # ตั้งค่าตอน receive() ถูกเรียกครั้งแรก
        self.tool_responses: list = []

    def _push(self, item) -> None:
        """เรียกจากเทรดของเทสได้อย่างปลอดภัย — busy-wait สั้น ๆ รอ receive() ตั้ง _loop ก่อน (ปกติ
        เกิดเร็วมากตั้งแต่ WS accept() เพราะ gemini_to_browser เรียก receive() ทันที)"""
        import time as _time

        while self._loop is None:
            _time.sleep(0.001)
        self._loop.call_soon_threadsafe(self._queue.put_nowait, item)

    def push_turn(self, items: list) -> None:
        """ป้อน 1 เทิร์นเต็ม (จบด้วย turn_complete=True เอง) — receive() จะ yield ทีละ item
        แล้วจบตัวเองหลัง item สุดท้าย เหมือน SDK จริง"""
        for item in items:
            self._push(item)
        self._push(_END_OF_TURN)

    def push_go_away(self) -> None:
        """ป้อน GoAway เดี่ยว ๆ — gemini_to_browser จะ return ทันทีที่เจอ (ไม่ต้องมี _END_OF_TURN
        ตาม เพราะฟังก์ชัน return ก่อนถึงจุดนั้นอยู่แล้ว)"""
        self._push(make_go_away_response())

    async def send_realtime_input(self, audio=None, activity_start=None, activity_end=None):
        pass

    async def send_tool_response(self, function_responses):
        self.tool_responses.append(function_responses)

    async def receive(self):
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        while True:
            item = await self._queue.get()
            if item is _END_OF_TURN:
                return
            yield item


class _FakeLiveConnect:
    def __init__(self, session: FakeSession) -> None:
        self._session = session

    async def __aenter__(self) -> FakeSession:
        return self._session

    async def __aexit__(self, *exc: object) -> bool:
        return False


def _make_fake_genai_client_class(session: FakeSession):
    class FakeLive:
        def connect(self, model: str, config: object):  # noqa: ARG002
            return _FakeLiveConnect(session)

    class FakeAio:
        def __init__(self) -> None:
            self.live = FakeLive()

    class FakeClient:
        def __init__(self, api_key: str | None = None) -> None:  # noqa: ARG002
            self.aio = FakeAio()

    return FakeClient


def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(voice_module.router)
    return app


def _drain_until(ws, want_type: str, timeout: float = 5.0) -> dict:
    """อ่านข้อความจาก ws จนกว่าจะเจอ message type ที่ต้องการ คืน dict ของทุก message ที่เจอระหว่างทาง"""
    seen: dict[str, list] = {}
    while True:
        try:
            msg = ws._send_queue.get(timeout=timeout)
        except _queue.Empty as exc:
            raise TimeoutError(f"ไม่ได้รับ {want_type!r} ภายใน {timeout}s (เจอมาแล้ว: {seen})") from exc
        if isinstance(msg, BaseException):
            raise msg
        if msg.get("bytes") is not None:
            continue
        text = msg.get("text")
        if text is None:
            continue
        payload = json.loads(text)
        seen.setdefault(payload.get("type", "?"), []).append(payload)
        if payload.get("type") == want_type:
            return seen


def _max_session_id(db) -> int:
    return db.query(func.max(ConversationSession.id)).scalar() or 0


@pytest.fixture()
def db():
    session = SessionLocal()
    yield session
    session.close()


def test_goaway_does_not_appear_anywhere_near_record_turn_in_voice_ws() -> None:
    """Structural guard — ไม่ใช่เทสพฤติกรรม แต่กันการ regress ที่อันตรายที่สุดของก้อนนี้: ห้ามมีใคร
    (ตอนนี้หรืออนาคต) เผลอเรียก tracker.record_turn() จากใน branch ที่จัดการ response.go_away เพราะ
    นั่นจะทำให้ GoAway (เกิดทุก ~15 นาทีตาม Gemini Live session limit) ถูกนับเป็นกิจกรรมของผู้ใช้/
    ปิด analytics session แบบผิด ๆ

    เช็คโดยอ่าน source จริงของ routers/voice.py แล้วยืนยันว่า record_turn( ปรากฏแค่ 2 จุดตามที่ตั้งใจ
    (speech_start ของ browser_to_gemini, turn_complete ของ gemini_to_browser) และ "if response.go_away"
    กับ "record_turn(" ไม่อยู่ในช่วงบรรทัดเดียวกันกับ return ของ go_away branch เลย
    (พฤติกรรมจริงที่ record_turn ไม่ถูกเรียกจาก reconnect เลย พิสูจน์แยกด้วย
    test_session_tracker_watchdog_ignores_everything_except_record_turn ด้านล่าง — เทสนี้แค่ยันโครงสร้างโค้ด)"""
    import inspect

    source = inspect.getsource(voice_module)
    # ".record_turn(" (มีจุดนำหน้า) กันไม่ให้นับคำอธิบายในคอมเมนต์ที่พูดถึง "record_turn(" เฉย ๆ
    # (ไม่มี "tracker." นำหน้า) โดยไม่ตั้งใจ — นับเฉพาะการเรียกจริงเท่านั้น
    assert source.count(".record_turn(") == 2, (
        "คาดว่า tracker.record_turn( ถูกเรียกแค่ 2 จุด (speech_start, turn_complete) — ถ้าตัวเลขเปลี่ยน "
        "ต้องตรวจสอบว่าจุดใหม่ที่เพิ่มไม่ได้อยู่ใน GoAway/reconnect branch"
    )

    go_away_branch_start = source.index('if response.go_away:')
    go_away_branch_end = source.index("resumption_state[\"go_away\"] = True")
    go_away_branch = source[go_away_branch_start:go_away_branch_end]
    assert "record_turn(" not in go_away_branch, "record_turn ถูกเรียกใน GoAway branch — ห้ามเด็ดขาด"


def test_session_tracker_watchdog_ignores_everything_except_record_turn() -> None:
    """ทดสอบ SessionTracker ตรง ๆ ไม่ผ่าน WS/FakeSession/thread ใด ๆ เลย (deterministic เต็มร้อย
    ต่างจากเทส WS ด้านล่างที่ผ่าน TestClient เทรดแยก) — พิสูจน์ 3 อย่างพร้อมกัน:
      1. เงียบไม่ครบเกณฑ์ (สั้นกว่า silence_timeout_s) ต้องไม่ปิด session
      2. เงียบครบเกณฑ์ต้องปิด session (TIMEOUT) แล้วเริ่มนับ session ใหม่ถูกต้องเมื่อมี turn ถัดมา
      3. stop() (จำลอง WS หลุด) ต้อง flush session ที่เปิดค้างอยู่ทันที ไม่ต้องรอ timeout เลย
    ไม่มีจุดไหนเรียกอะไรที่เกี่ยวกับ GoAway เลยตลอดเทสนี้ — ตรงกับพฤติกรรมจริงที่ reconnect ไม่แตะ
    tracker เลยแม้แต่บรรทัดเดียว (ดู routers/voice.py: SessionTracker ถูกสร้างครั้งเดียวนอก
    reconnect while-loop และ record_turn ถูกเรียกจาก speech_start/turn_complete เท่านั้น)"""
    from app.services.session_tracker import SessionTracker

    async def scenario() -> list[int]:
        db = SessionLocal()
        try:
            max_id_before = _max_session_id(db)
            ws_connection_id = f"unit-test-{max_id_before}"
            tracker = SessionTracker(ws_connection_id, silence_timeout_s=0.2)
            tracker.start()

            # เทิร์นแรก (จำลอง GoAway กลางทางด้วยการ "ไม่ทำอะไรเลย" — เพราะของจริงก็ไม่เรียก
            # record_turn จาก reconnect เหมือนกัน มีแค่ time ผ่านไปเฉย ๆ สั้นกว่าเกณฑ์)
            tracker.record_turn(Speaker.USER)
            await asyncio.sleep(0.05)
            tracker.record_turn(Speaker.BOT)
            await asyncio.sleep(0.1)  # < 0.2s เกณฑ์ — ต้องยังไม่ปิด

            db.expire_all()
            assert _max_session_id(db) == max_id_before, "เงียบไม่ครบเกณฑ์ ห้ามปิด session ก่อนเวลา"

            await asyncio.sleep(0.25)  # รวมเกิน 0.2s แล้ว (0.1+0.25) — ต้องปิด session แรกอัตโนมัติ

            db.expire_all()
            first = (
                db.query(ConversationSession)
                .filter(ConversationSession.id > max_id_before)
                .order_by(ConversationSession.id)
                .all()
            )
            assert len(first) == 1, f"เงียบครบเกณฑ์แล้วต้องปิด session ที่ 1 แต่ได้ {len(first)}"
            assert first[0].message_count == 2
            assert first[0].end_reason == SessionEndReason.TIMEOUT

            # session ที่ 2 — คุยต่อในการเชื่อมต่อเดิม
            tracker.record_turn(Speaker.USER)
            await asyncio.sleep(0.02)
            tracker.record_turn(Speaker.BOT)
            # ปิดทันที (จำลอง ws หลุด) ไม่ต้องรอ timeout เลย
            await tracker.stop(SessionEndReason.UNKNOWN)

            db.expire_all()
            all_new = (
                db.query(ConversationSession)
                .filter(ConversationSession.id > max_id_before)
                .order_by(ConversationSession.id)
                .all()
            )
            assert len(all_new) == 2, f"คาดว่ามี 2 session แยกกัน แต่ได้ {len(all_new)}"
            assert all_new[1].message_count == 2
            assert all_new[1].end_reason == SessionEndReason.UNKNOWN
            assert all_new[1].started_at > all_new[0].ended_at

            turns = (
                db.query(ConversationTurn)
                .filter(ConversationTurn.ws_connection_id == ws_connection_id)
                .all()
            )
            assert len(turns) == 4
            return [s.id for s in all_new]
        finally:
            db.close()

    asyncio.run(scenario())


def test_ws_disconnect_flushes_open_session_without_waiting_for_timeout(
    monkeypatch: pytest.MonkeyPatch, db
) -> None:
    """ปิด ws ทันทีหลังคุยจบ 1 เทิร์น (ไม่รอ silence timeout เลย) ต้องยัง insert session ให้ถูก
    ไม่ค้างเป็น session ที่ไม่มีวันจบ"""
    session = FakeSession()
    monkeypatch.setattr(voice_module.genai, "Client", _make_fake_genai_client_class(session))
    monkeypatch.setattr(voice_module.settings, "GEMINI_API_KEY", "fake-key-for-test")
    monkeypatch.setattr(voice_module.settings, "BACKEND_SESSION_SILENCE_TIMEOUT_S", 60.0)

    max_id_before = _max_session_id(db)

    app = _build_test_app()
    client = TestClient(app)
    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "speech_start"})
        ws.send_bytes(b"\x00" * 640)
        ws.send_json({"type": "speech_end"})
        session.push_turn([make_response(data=b"a1"), make_response(transcript="ans1", turn_complete=True)])
        _drain_until(ws, "turn_complete")
    # ออกจาก `with` แล้ว = client ปิด ws ทันที (เหมือนปิดแท็บ) โดยไม่รอ 60s เลย

    db.expire_all()
    closed = (
        db.query(ConversationSession)
        .filter(ConversationSession.id > max_id_before)
        .order_by(ConversationSession.id)
        .all()
    )
    assert len(closed) == 1, "ws หลุดกลางคันต้อง flush session ที่เปิดค้างอยู่ทันที"
    assert closed[0].end_reason == SessionEndReason.UNKNOWN
    assert closed[0].message_count == 2


def test_flag_off_topic_still_works_unaffected_by_session_tracker(
    monkeypatch: pytest.MonkeyPatch, db
) -> None:
    """flag_off_topic ต้องยังส่ง {"type":"off_topic"} ให้ frontend เหมือนเดิมทุกประการ และบทสนทนา
    ต้องดำเนินต่อได้ปกติ (ยังได้ turn_complete) — พิสูจน์ว่า hook เก็บ turn ไม่ไปแทรก/เปลี่ยน flow นี้"""
    off_topic_call = make_tool_call_response("flag_off_topic", {"topic": "อากาศวันนี้"})
    session = FakeSession()
    monkeypatch.setattr(voice_module.genai, "Client", _make_fake_genai_client_class(session))
    monkeypatch.setattr(voice_module.settings, "GEMINI_API_KEY", "fake-key-for-test")
    monkeypatch.setattr(voice_module.settings, "BACKEND_SESSION_SILENCE_TIMEOUT_S", 60.0)

    max_id_before = _max_session_id(db)

    app = _build_test_app()
    client = TestClient(app)
    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "speech_start"})
        ws.send_bytes(b"\x00" * 640)
        ws.send_json({"type": "speech_end"})
        session.push_turn([off_topic_call, make_response(transcript="ขอโทษด้วยค่ะ", turn_complete=True)])
        seen = _drain_until(ws, "turn_complete")

    assert "off_topic" in seen, "off_topic message หายไป — session tracker กระทบ flow เดิม"
    assert seen["off_topic"] == [{"type": "off_topic"}]
    assert len(session.tool_responses) == 1  # ยัง send_tool_response กลับให้ Gemini เหมือนเดิม

    db.expire_all()
    closed = (
        db.query(ConversationSession)
        .filter(ConversationSession.id > max_id_before)
        .order_by(ConversationSession.id)
        .all()
    )
    assert len(closed) == 1
    # 1 user turn (speech_start) + 1 bot turn (turn_complete) — tool_call ตรงกลางไม่ทำให้นับ turn เกิน
    assert closed[0].message_count == 2
