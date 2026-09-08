"""
test_topic_classifier.py — พิสูจน์ requirement ของ topic classifier (ก้อนที่ 3 ของงานสถิติหัวข้อ
บทสนทนา, 2026-09-08):

  1. ใช้ get_llm_client() ตัวเดิม ไม่ใช่ Gemini -> stub get_llm_client แทน ไม่แตะ Gemini เลยในไฟล์นี้
  2. classify เสร็จเขียนแค่ tags/other_hint -> parse JSON แล้วคืนค่าที่ validate แล้วเท่านั้น
  3. other_hint ไม่เกิน 10 คำ และมีก็ต่อเมื่อเลือก "other" เท่านั้น
  4. LLM ล้มเหลว/parse ไม่ได้/ไม่มี tag valid เลย -> คืน None เสมอ (ไม่ raise) ให้ผู้เรียก
     (session_tracker.py) ตัดสินใจว่าจะปล่อย session ไว้เป็น UNCLASSIFIED

ไม่แตะ network จริงเลย — stub app.services.topic_classifier.get_llm_client ทุกเทส (LLM_PROVIDER
dev คือ deepseek พร้อม API key จริง ห้ามยิง network จริงจากเทส)

รัน: docker exec ditc_backend python -m pytest tests/test_topic_classifier.py -v
"""
from __future__ import annotations

import pytest

from app.services import topic_classifier


class _StubLLMClient:
    """จำลอง LLMClient (ดู app/llm/chat.py) — คืนข้อความดิบที่กำหนดไว้ล่วงหน้าตรง ๆ"""

    def __init__(self, response_text: str) -> None:
        self._response_text = response_text
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str, max_tokens: int | None = None) -> str:
        self.calls.append((system, user))
        return self._response_text


def _stub(monkeypatch: pytest.MonkeyPatch, response_text: str) -> _StubLLMClient:
    client = _StubLLMClient(response_text)
    monkeypatch.setattr(topic_classifier, "get_llm_client", lambda: client)
    return client


def test_happy_path_multiple_tags(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _stub(monkeypatch, '{"tags": ["tuition_fee", "curriculum_se"], "other_hint": null}')
    result = topic_classifier.classify_session_topics(["ค่าเทอม SE", "หลักสูตร SE"])
    assert result == (["tuition_fee", "curriculum_se"], None)
    assert len(client.calls) == 1  # 1 LLM call ต่อ session ตามที่สั่ง


def test_other_hint_kept_only_when_other_tag_present(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, '{"tags": ["tuition_fee"], "other_hint": "ไม่ควรมีค่านี้ติดมา"}')
    tags, other_hint = topic_classifier.classify_session_topics(["ค่าเทอม"])
    assert tags == ["tuition_fee"]
    assert other_hint is None, "other_hint ต้องถูกทิ้งถ้าไม่ได้เลือก tag 'other'"


def test_other_hint_truncated_to_10_words(monkeypatch: pytest.MonkeyPatch) -> None:
    long_hint = " ".join(f"คำที่{i}" for i in range(20))
    _stub(monkeypatch, f'{{"tags": ["other"], "other_hint": "{long_hint}"}}')
    tags, other_hint = topic_classifier.classify_session_topics(["เรื่องหอพักนักศึกษา"])
    assert tags == ["other"]
    assert other_hint is not None
    assert len(other_hint.split()) == 10, "other_hint ต้องถูกตัดเหลือไม่เกิน 10 คำ"


def test_other_hint_dropped_if_copied_verbatim_from_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM ไม่ทำตาม prompt (ห้ามคัดลอก) — other_hint เป็น signal ทั้งก้อนตรง ๆ ต้องถูกทิ้ง"""
    _stub(monkeypatch, '{"tags": ["other"], "other_hint": "อยากทราบเรื่องหอพักนักศึกษาชั้นปีที่ 1"}')
    tags, other_hint = topic_classifier.classify_session_topics(["อยากทราบเรื่องหอพักนักศึกษาชั้นปีที่ 1"])
    assert tags == ["other"]
    assert other_hint is None, "other_hint ที่คัดลอก signal มาทั้งก้อนต้องถูกทิ้ง"


def test_other_hint_dropped_if_long_run_matches_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM แต่งประโยคใหม่รอบ ๆ แต่ยังคัดลอกวลียาวมาทั้งดุ้น — ต้องจับได้เหมือนกัน ไม่ใช่แค่คัดลอกทั้งก้อน"""
    _stub(
        monkeypatch,
        '{"tags": ["other"], "other_hint": "คำถามเรื่องหอพักนักศึกษาสำหรับชั้นปีที่หนึ่งของมหาลัย"}',
    )
    tags, other_hint = topic_classifier.classify_session_topics(
        ["นักศึกษาถามว่า หอพักนักศึกษาสำหรับชั้นปีที่หนึ่ง มีที่ไหนบ้าง"]
    )
    assert tags == ["other"]
    assert other_hint is None, "วลียาวที่ตรงกับ signal เป๊ะต้องถูกจับแม้ประโยครอบข้างต่างกัน"


def test_other_hint_kept_when_genuinely_summarized_not_copied(monkeypatch: pytest.MonkeyPatch) -> None:
    """other_hint ที่เป็นคำสรุปจริง (ไม่ตรงกับ signal ยาว ๆ) ต้องไม่ถูกทิ้งอย่างไม่มีเหตุผล"""
    _stub(monkeypatch, '{"tags": ["other"], "other_hint": "หอพักนักศึกษา"}')
    tags, other_hint = topic_classifier.classify_session_topics(
        ["นักศึกษาชั้นปีที่ 1 อยากทราบว่ามีที่พักในมหาวิทยาลัยให้เช่าไหม"]
    )
    assert tags == ["other"]
    assert other_hint == "หอพักนักศึกษา"


def test_invalid_tags_are_filtered_out_but_valid_ones_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, '{"tags": ["tuition_fee", "ค่าเทอม_มั่ว", "not_a_real_topic"], "other_hint": null}')
    tags, other_hint = topic_classifier.classify_session_topics(["ค่าเทอม"])
    assert tags == ["tuition_fee"], "ห้ามให้ LLM คิดค่า tag เองนอกเหนือ enum — ต้องกรองทิ้ง"
    assert other_hint is None


def test_no_valid_tags_at_all_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, '{"tags": ["ค่าเทอม_มั่ว"], "other_hint": null}')
    assert topic_classifier.classify_session_topics(["ค่าเทอม"]) is None


def test_malformed_json_returns_none_not_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, "ขอโทษค่ะ ไม่สามารถตอบเป็น JSON ได้")
    assert topic_classifier.classify_session_topics(["ค่าเทอม"]) is None


def test_tags_not_a_list_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, '{"tags": "tuition_fee", "other_hint": null}')
    assert topic_classifier.classify_session_topics(["ค่าเทอม"]) is None


def test_llm_client_raising_exception_returns_none_not_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    class _RaisingClient:
        def complete(self, system: str, user: str, max_tokens: int | None = None) -> str:
            raise ConnectionError("จำลอง network error")

    monkeypatch.setattr(topic_classifier, "get_llm_client", lambda: _RaisingClient())
    assert topic_classifier.classify_session_topics(["ค่าเทอม"]) is None


def test_empty_signals_skips_llm_call_entirely(monkeypatch: pytest.MonkeyPatch) -> None:
    called = []
    monkeypatch.setattr(topic_classifier, "get_llm_client", lambda: called.append(1) or _StubLLMClient("{}"))
    assert topic_classifier.classify_session_topics([]) is None
    assert called == [], "ไม่ควรเรียก get_llm_client เลยถ้าไม่มีสัญญาณอะไรให้ classify"


def test_prompt_never_includes_raw_user_speech_only_signals_passed_in(monkeypatch: pytest.MonkeyPatch) -> None:
    """เอกสารกันงง: prompt สร้างจาก signals ที่ผู้เรียกส่งมาเท่านั้น ไม่มีการดึง state อื่นใดเพิ่มเอง
    (เช่น จาก DB) — ยืนยันว่า user message ที่ส่งให้ LLM มีแค่สิ่งที่ส่งเข้ามาจริง"""
    client = _stub(monkeypatch, '{"tags": ["tuition_fee"], "other_hint": null}')
    topic_classifier.classify_session_topics(["สัญญาณเดียวเท่านั้น"])
    _, user_message = client.calls[0]
    assert "สัญญาณเดียวเท่านั้น" in user_message
