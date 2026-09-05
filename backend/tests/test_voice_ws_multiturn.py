"""
test_voice_ws_multiturn.py — regression test สำหรับบั๊ก "คุยได้แค่รอบเดียวต่อการกดปุ่ม"
(ดู docs/adr/voice-multiturn-session-bug.md)

สาเหตุจริงที่เจอ: session.receive() ของ google-genai SDK คืนคำตอบแค่ 1 เทิร์นแล้ว "จบตัวเอง"
เสมอ (ดู source จริง: `while result := await self._receive(): if turn_complete: yield result;
break; yield result`) — ถ้า routers/voice.py เรียก session.receive() แค่ครั้งเดียวโดยไม่มี
while True ครอบ (โค้ดเดิมก่อนแก้) ตัวรับ (gemini_to_browser) จะตายเงียบ ๆ หลังเทิร์นแรก แล้ว
เทิร์นที่ 2 จะไม่มีอะไรตอบกลับมาเลยแม้จะส่งเสียง/activity ถูกต้องครบทุกอย่าง

เทสนี้จำลอง Gemini session ด้วย fake object ที่มี receive() พฤติกรรมเหมือน SDK จริงเป๊ะ (จบเองทุก
เทิร์น) ไม่เรียก Gemini API จริง — ยิง 2 เทิร์นติดกันผ่าน WebSocket เดียวกัน (ไม่ปิด-เปิดใหม่) ถ้า
routers/voice.py ถอยกลับไปเป็นโค้ดเดิม เทสนี้จะค้าง/timeout ตอนรอเทิร์นที่ 2 ทันที

รัน: docker exec ditc_backend python -m pytest tests/test_voice_ws_multiturn.py -v
"""
import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import voice as voice_module


def make_response(data: bytes | None = None, transcript: str | None = None, turn_complete: bool = False):
    server_content = SimpleNamespace(
        output_transcription=SimpleNamespace(text=transcript) if transcript else None,
        turn_complete=turn_complete,
    )
    return SimpleNamespace(tool_call=None, data=data, server_content=server_content)


class FakeSession:
    """จำลอง session.receive() ของ SDK จริง: yield ทีละ response ในเทิร์นปัจจุบัน แล้วจบตัวเอง
    (StopAsyncIteration) ทันทีที่เจอ turn_complete — ต้องเรียก receive() ใหม่สำหรับเทิร์นถัดไป
    (นี่คือพฤติกรรมจริงของ SDK ที่ทำให้บั๊กนี้เกิด ไม่ใช่แค่ mock เดา ๆ)"""

    def __init__(self, turns: list[list]) -> None:
        self._turns = turns
        self._turn_idx = 0
        self.activity_starts = 0
        self.activity_ends = 0
        self.audio_chunks_received = 0

    async def send_realtime_input(self, audio=None, activity_start=None, activity_end=None):
        if audio is not None:
            self.audio_chunks_received += 1
        if activity_start is not None:
            self.activity_starts += 1
        if activity_end is not None:
            self.activity_ends += 1

    async def send_tool_response(self, function_responses):  # pragma: no cover - ไม่มี tool call ในเทสนี้
        pass

    async def receive(self):
        if self._turn_idx >= len(self._turns):
            # เทิร์นที่กำหนดไว้หมดแล้ว — session จริงจะ "เงียบรอ" ไม่ใช่ return ทันที (ถ้า return
            # ทันที outer `while True: async for ... in session.receive()` ของโค้ดจริงจะวน busy-loop
            # ไม่มี await ค้างเลย กิน CPU 100% แทนที่จะ block รอเหมือนของจริง) ใช้ Event ที่ไม่มีวัน
            # set แทน ให้ค้างรอเฉย ๆ จนกว่า task จะโดน cancel ตอน ws ปิด (เหมือนพฤติกรรมจริง)
            await asyncio.Event().wait()
            return
        turn = self._turns[self._turn_idx]
        self._turn_idx += 1
        for item in turn:
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
    # สร้าง FastAPI app เปล่า ๆ mount แค่ voice router — ไม่ผ่าน app.main (เลี่ยง lifespan ที่เช็ค
    # embedding dim + connect DB จริง ซึ่งไม่เกี่ยวกับสิ่งที่เทสนี้ต้องการพิสูจน์เลย)
    app = FastAPI()
    app.include_router(voice_module.router)
    return app


def _drain_turn(ws, timeout: float = 5.0) -> dict:
    """อ่านข้อความจาก ws จนกว่าจะเจอ turn_complete คืน dict สรุป (bytes รวม, transcript รวม)

    ใช้ queue.get(timeout=...) ตรง ๆ แทน ws.receive() เฉย ๆ (ที่ block ไม่มี timeout) — ถ้าบั๊กเดิม
    กลับมา (session.receive() เรียกครั้งเดียว) เทิร์นที่ 2 จะไม่มีอะไรส่งมาเลย อยากให้เทส fail ด้วย
    TimeoutError ชัดเจนใน 5 วิ แทนที่จะค้างทั้ง CI job"""
    import queue as _queue

    total_bytes = 0
    transcript = ""
    while True:
        try:
            msg = ws._send_queue.get(timeout=timeout)
        except _queue.Empty as exc:
            raise TimeoutError(
                f"ไม่ได้รับ turn_complete ภายใน {timeout}s — receiver อาจตายไปแล้ว "
                "(นี่คือ regression ของบั๊ก 'คุยได้แค่รอบเดียว')"
            ) from exc
        if isinstance(msg, BaseException):
            raise msg
        data_bytes = msg.get("bytes")
        if data_bytes is not None:
            total_bytes += len(data_bytes)
            continue
        text = msg.get("text")
        if text is None:
            continue
        payload = json.loads(text)
        if payload.get("type") == "transcript":
            transcript += payload.get("text", "")
        elif payload.get("type") == "turn_complete":
            return {"bytes": total_bytes, "transcript": transcript}


def test_multiturn_over_single_ws_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    """2 เทิร์นติดกันในการเชื่อมต่อเดียว ไม่ปิด-เปิด ws ใหม่ — regression หลักของบั๊กนี้"""
    session = FakeSession(turns=[
        [make_response(data=b"audio-turn-1"), make_response(transcript="คำตอบที่ 1", turn_complete=True)],
        [make_response(data=b"audio-turn-2"), make_response(transcript="คำตอบที่ 2", turn_complete=True)],
    ])
    monkeypatch.setattr(voice_module.genai, "Client", _make_fake_genai_client_class(session))
    monkeypatch.setattr(voice_module.settings, "GEMINI_API_KEY", "fake-key-for-test")

    app = _build_test_app()
    client = TestClient(app)
    with client.websocket_connect("/api/voice/ws") as ws:
        ws.send_json({"type": "speech_start"})
        ws.send_bytes(b"\x00" * 640)
        ws.send_json({"type": "speech_end"})
        turn1 = _drain_turn(ws)
        assert turn1 == {"bytes": len(b"audio-turn-1"), "transcript": "คำตอบที่ 1"}

        # นี่คือจุดที่บั๊กเดิม (session.receive() เรียกครั้งเดียว) จะทำให้เงียบสนิท ไม่มี turn_complete
        # ส่งกลับมาเลย ws.receive() จะค้างรอตลอดไป (เทสจะ timeout/hang แทนที่จะ fail แบบ assertion ปกติ)
        ws.send_json({"type": "speech_start"})
        ws.send_bytes(b"\x00" * 640)
        ws.send_json({"type": "speech_end"})
        turn2 = _drain_turn(ws)
        assert turn2 == {"bytes": len(b"audio-turn-2"), "transcript": "คำตอบที่ 2"}

    assert session.activity_starts == 2
    assert session.activity_ends == 2
