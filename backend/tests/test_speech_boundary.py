"""
test_speech_boundary.py — เทส SpeechBoundaryTracker (app/services/speech_boundary.py)

ครอบ 2 ใน 3 ข้อที่ต้องมีตามที่ผู้ใช้ระบุ (ข้อ "multi-turn ผ่าน WS connection เดียว" อยู่ใน
tests/test_voice_ws_multiturn.py แยกต่างหาก):
  - state ของ speech flag หลังผ่านช่วง mute (half-duplex) ต้องไม่ค้าง ไม่งั้นรอบถัดไปจะไม่ส่ง
    speech_start เลย (บั๊กจริงที่เจอ 2026-09-06 หลังแก้บั๊กแรกแล้ว ดู
    docs/adr/voice-multiturn-session-bug.md)
  - hangover ต้องไม่ตัดกลางประโยคตอนมีการเว้นวรรค/หายใจสั้น ๆ (เงียบไม่ถึง threshold)

ตัวเดียวกับที่ voice_pipeline_dev.py ใช้จริงใน mic_to_gemini() — เทสนี้เทสของจริง ไม่ใช่ mock/
reimplementation แยก

รัน: docker exec ditc_backend python -m pytest tests/test_speech_boundary.py -v
"""
from app.services.speech_boundary import BoundaryEvent, SpeechBoundaryTracker


def test_start_emitted_on_first_speech_frame():
    tracker = SpeechBoundaryTracker(hangover_frames=3, initial_speech=False)
    assert tracker.on_frame(is_speech=True) is BoundaryEvent.START
    assert tracker.in_utterance is True


def test_start_not_duplicated_while_still_speaking():
    tracker = SpeechBoundaryTracker(hangover_frames=3, initial_speech=False)
    tracker.on_frame(is_speech=True)
    assert tracker.on_frame(is_speech=True) is None
    assert tracker.on_frame(is_speech=True) is None


def test_hangover_survives_short_pause_mid_sentence():
    """เว้นวรรค/หายใจสั้น ๆ (เงียบไม่ถึง hangover_frames) ต้องไม่ตัดกลางประโยค — ห้ามส่ง END
    และต้องยังถือว่า in_utterance=True ตลอดช่วงนั้น แล้วพอพูดต่อต้องไม่ส่ง START ซ้ำ (เพราะยังเป็น
    ประโยคเดียวกันอยู่ ไม่ใช่เริ่มใหม่)"""
    tracker = SpeechBoundaryTracker(hangover_frames=5, initial_speech=False)
    assert tracker.on_frame(is_speech=True) is BoundaryEvent.START  # "DITC..."

    # เว้นวรรค 3 เฟรม (< hangover_frames=5) — ยังไม่ควรจบประโยค
    for _ in range(3):
        event = tracker.on_frame(is_speech=False)
        assert event is None
        assert tracker.in_utterance is True

    # พูดต่อ ("...คืออะไร") — ต้องไม่ส่ง START ซ้ำ เพราะยังเป็นประโยคเดียวกัน
    assert tracker.on_frame(is_speech=True) is None
    assert tracker.in_utterance is True


def test_end_emitted_only_after_hangover_exceeded():
    tracker = SpeechBoundaryTracker(hangover_frames=5, initial_speech=False)
    tracker.on_frame(is_speech=True)

    for _ in range(4):  # ยังไม่ถึง hangover_frames=5
        assert tracker.on_frame(is_speech=False) is None
    assert tracker.in_utterance is True

    assert tracker.on_frame(is_speech=False) is BoundaryEvent.END  # เฟรมที่ 5 ถึง threshold พอดี
    assert tracker.in_utterance is False


def test_muted_flushes_pending_speech_and_resets_state():
    """regression: ผู้ใช้พูดค้างอยู่ตอนโดน half-duplex mute (เช่น พูดคาบเกี่ยวจังหวะที่แมวเริ่มพูด)
    — ต้องปิด activity ทันที (คืน END) ไม่ใช่ปล่อยให้ state ค้าง"""
    tracker = SpeechBoundaryTracker(hangover_frames=5, initial_speech=False)
    tracker.on_frame(is_speech=True)
    assert tracker.in_utterance is True

    assert tracker.on_muted() is BoundaryEvent.END
    assert tracker.in_utterance is False


def test_start_emitted_again_after_mute_flush_not_suppressed():
    """regression หลัก: ถ้า state ไม่ถูกรีเซ็ตตอน mute, was_speech จะค้าง True ข้ามรอบ mute แล้ว
    isSpeech=True รอบถัดไปจะไม่ส่ง START ให้เลย (เพราะเงื่อนไข is_speech and not was_speech เป็น
    false ตลอด) — เป็นบั๊กเดียวกับที่ทำให้ 'คุยได้แค่รอบเดียว' กลับมาผ่านทางอ้อมหลังแก้บั๊กแรกแล้ว"""
    tracker = SpeechBoundaryTracker(hangover_frames=5, initial_speech=False)
    tracker.on_frame(is_speech=True)  # คำถามที่ 1 เริ่มพูด
    tracker.on_muted()  # โดน mute กลางคัน (จำลองเคสเลวร้ายสุด) ต้อง flush ให้เรียบร้อย

    # ผู้ใช้เริ่มถามคำถามที่ 2 จริง ๆ หลังไมค์เปิดกลับมา — ต้องได้ START ไม่ใช่ None
    assert tracker.on_frame(is_speech=True) is BoundaryEvent.START


def test_muted_while_silent_is_a_noop():
    tracker = SpeechBoundaryTracker(hangover_frames=5, initial_speech=False)
    assert tracker.on_muted() is None
    assert tracker.in_utterance is False


def test_initial_speech_true_matches_session_just_opened_because_of_detected_speech():
    """voice_pipeline_dev.py เปิด session เพราะ VAD นอก loop เจอเสียงพูดแล้ว (ส่ง activity_start
    ไปแล้วก่อนตั้ง tracker) — initial_speech=True ต้องไม่ทำให้ on_frame ส่ง START ซ้ำซ้อน"""
    tracker = SpeechBoundaryTracker(hangover_frames=3, initial_speech=True)
    assert tracker.in_utterance is True
    assert tracker.on_frame(is_speech=True) is None


def test_hangover_frames_must_be_positive():
    import pytest

    with pytest.raises(ValueError):
        SpeechBoundaryTracker(hangover_frames=0)
