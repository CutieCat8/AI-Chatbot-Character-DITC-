"""
speech_boundary.py — ตัดสินใจ speech_start/speech_end (activity boundary) จากผล VAD/RMS แบบ
เฟรมต่อเฟรม พร้อม hangover (กันตัดกลางประโยคที่มีช่วงเว้นวรรค/หายใจสั้น ๆ) และกันบั๊ก state ค้าง
ข้ามช่วง half-duplex mute — แยกออกมาจาก voice_pipeline_dev.py เป็นโมดูลนี้เพื่อให้เทสได้โดยไม่ต้อง
พึ่งไมค์/Gemini จริง (ที่มาของบั๊กและการแก้ ดู docs/adr/voice-multiturn-session-bug.md)

ตรรกะเดียวกันนี้ (RMS threshold + hangover + reset-on-mute) implement แยกอีกชุดใน
frontend-character/src/hooks/useVoiceSocket.ts (TypeScript ฝั่ง browser) — คนละภาษา share โค้ด
กันไม่ได้ แต่ต้อง "คิดเหมือนกัน" เป๊ะ ถ้าแก้ตรงนี้ต้องพิจารณาแก้ที่นั่นด้วย (และกลับกัน)
"""
from __future__ import annotations

from enum import Enum


class BoundaryEvent(str, Enum):
    START = "start"
    END = "end"


class SpeechBoundaryTracker:
    """เรียก on_frame()/on_muted() ทุกเฟรมเสียง คืน BoundaryEvent ถ้าต้องส่ง activity_start/end
    ออกไปจริง ไม่งั้นคืน None — เก็บ state (was_speech, silent_streak) ไว้ในตัวเอง ไม่รู้จัก
    Gemini/session เลย (ผู้เรียกเป็นคนส่ง activity_start/end จริงเอง)"""

    def __init__(self, hangover_frames: int, initial_speech: bool = False) -> None:
        if hangover_frames < 1:
            raise ValueError("hangover_frames ต้อง >= 1")
        self.hangover_frames = hangover_frames
        self.was_speech = initial_speech
        self.silent_streak = 0

    @property
    def in_utterance(self) -> bool:
        """ถือว่ายังอยู่ในประโยคเดียวกันไหม (รวมช่วง hangover ที่ยังไม่ยืนยันว่าจบ) — ผู้เรียกใช้
        ค่านี้ตัดสินว่าควรส่งเฟรมเสียงปัจจุบันเข้า Gemini ต่อไหม"""
        return self.was_speech

    def on_frame(self, is_speech: bool) -> BoundaryEvent | None:
        """เรียกตอนไม่ได้ mute — ส่งผล VAD/RMS ของเฟรมปัจจุบันเข้ามา"""
        if is_speech:
            self.silent_streak = 0
            if not self.was_speech:
                self.was_speech = True
                return BoundaryEvent.START
            return None
        if self.was_speech:
            self.silent_streak += 1
            if self.silent_streak >= self.hangover_frames:
                self.was_speech = False
                self.silent_streak = 0
                return BoundaryEvent.END
        return None

    def on_muted(self) -> BoundaryEvent | None:
        """เรียกตอนเข้าสู่ช่วง half-duplex mute (แมวกำลังพูด) — ถ้ามีประโยคค้างอยู่ (ยังไม่ทัน
        hangover ยืนยันว่าจบ) ต้องปิดทันที ไม่งั้น state ค้างข้ามรอบ mute แล้วรอบถัดไปที่ผู้ใช้เริ่ม
        พูดจริงจะไม่ถูกส่ง speech_start ให้เลย (บั๊กจริงที่เจอ 2026-09-06 ดู ADR ด้านบน)"""
        if self.was_speech:
            self.was_speech = False
            self.silent_streak = 0
            return BoundaryEvent.END
        self.silent_streak = 0
        return None
