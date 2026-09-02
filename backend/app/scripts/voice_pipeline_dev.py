"""
voice_pipeline_dev.py — วงจรเสียงเต็มรูปแบบบนเครื่อง dev: ไมค์จริง -> VAD -> Gemini Live -> ลำโพงจริง

ต่างจาก routers/voice.py (WS bridge ที่รอ browser เป็นคนจับเสียง/VAD/buffer) — ไฟล์นี้ทำเองทั้งหมด
บนเครื่อง ไม่ต้องมี frontend เลย ใช้ทดสอบวงจรทั้งวงจบก่อนต่อ frontend-character จริง

สถาปัตยกรรม:
  ไมค์ (sounddevice, 16kHz PCM16 mono, เฟรมละ 32ms) --เข้าคิว asyncio--> ตรวจ VAD (silero, ต่อเนื่องทุกเฟรม)
    - เงียบอยู่ ไม่มี session: แค่เก็บ pre-roll buffer สั้น ๆ รอฟังจนกว่าจะเจอเสียงพูด
    - เจอเสียงพูดเริ่ม (silence -> speech): เปิด Gemini Live session ใหม่ ส่ง pre-roll + เสียงต่อเนื่องเข้าไป
    - อยู่ใน session: ส่งเสียงไมค์เข้า Gemini ต่อเนื่องเสมอ (ให้ AAD ของ Gemini เองจัดการ turn/barge-in)
      ขนานกับ track เวลาเงียบต่อเนื่องฝั่งเรา (นับเฉพาะตอนไม่ได้รอคำตอบอยู่) เพื่อปิด session เอง
  Gemini Live --tool_call--> เรียก retrieval.py เดิม (เหมือน routers/voice.py) ส่งผลกลับ
  Gemini Live --audio (24kHz PCM16 mono)--> เข้าคิวเล่นเสียง บัฟไว้ AUDIO_OUTPUT_BUFFER_S วิ ก่อนเริ่มเล่น
    - ได้สัญญาณ interrupted (ผู้ใช้พูดแทรก) --> เคลียร์บัฟ+หยุดเล่นทันที (บาร์จอิน)
  หลุดการเชื่อมต่อ --> เล่นประโยคสำรอง (แคชไว้ล่วงหน้า ไม่ง้อ Gemini) แล้ว reconnect แบบ backoff

รัน: cd backend && .venv/Scripts/python -m app.scripts.voice_pipeline_dev
กด Ctrl+C เพื่อหยุด (ปิด session/stream ให้เรียบร้อยก่อนออก)

ปรับพฤติกรรมได้ผ่าน .env: VAD_SPEECH_THRESHOLD, VAD_SILENCE_TIMEOUT_S, AUDIO_OUTPUT_BUFFER_S,
VOICE_RECONNECT_MAX_BACKOFF_S (ดู app/config.py)
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from pathlib import Path
from typing import Callable

import numpy as np
import sounddevice as sd
import torch
from google import genai
from google.genai import types
from google.genai.errors import ClientError, ServerError
from gtts import gTTS
from silero_vad import load_silero_vad
from websockets.exceptions import WebSocketException

from app.config import settings
from app.routers.voice import MODEL, SEARCH_FUNCTION, SYSTEM_INSTRUCTION, run_retrieval

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("voice_pipeline_dev")

INPUT_RATE = 16000
OUTPUT_RATE = 24000
VAD_FRAME_SAMPLES = 512  # silero-vad ต้องการเฟรม 512 samples ที่ 16kHz (=32ms) พอดี
VAD_FRAME_BYTES = VAD_FRAME_SAMPLES * 2  # int16 mono
PRE_ROLL_FRAMES = 10  # ~320ms กันคำแรกหายตอนเปิด session ช้ากว่าที่เริ่มพูด

FALLBACK_TEXT = "ขอโทษค่ะ สัญญาณขาดหายไปสักครู่ เดี๋ยวเชื่อมต่อใหม่ให้นะคะ"
FALLBACK_CACHE = Path(__file__).parent / "_voice_cache" / "fallback_24k.pcm"


# ---------------------------------------------------------------------------
# เสียงสำรองตอนหลุด — สังเคราะห์ครั้งเดียวแล้วแคชไว้ ตอน reconnect จะได้เล่นได้ทันที ไม่ต้องรอเน็ต/Gemini
# ---------------------------------------------------------------------------
def ensure_fallback_audio() -> bytes:
    if FALLBACK_CACHE.exists():
        return FALLBACK_CACHE.read_bytes()

    import subprocess

    FALLBACK_CACHE.parent.mkdir(exist_ok=True)
    mp3_path = FALLBACK_CACHE.with_suffix(".mp3")
    gTTS(text=FALLBACK_TEXT, lang="th").save(str(mp3_path))
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp3_path), "-ar", str(OUTPUT_RATE), "-ac", "1", "-f", "s16le", str(FALLBACK_CACHE)],
        check=True, capture_output=True,
    )
    mp3_path.unlink(missing_ok=True)
    logger.info("สร้าง fallback audio cache แล้ว: %s", FALLBACK_CACHE)
    return FALLBACK_CACHE.read_bytes()


# ---------------------------------------------------------------------------
# ไมค์: sounddevice callback (รันคนละ thread) -> ผลัก raw bytes เข้า asyncio.Queue ของ event loop หลัก
# ---------------------------------------------------------------------------
class MicSource:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self.queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._stream = sd.RawInputStream(
            samplerate=INPUT_RATE, channels=1, dtype="int16",
            blocksize=VAD_FRAME_SAMPLES, callback=self._callback,
        )

    def _callback(self, indata, frames, time_info, status) -> None:
        if status:
            logger.debug("mic status: %s", status)
        data = bytes(indata)
        self._loop.call_soon_threadsafe(self.queue.put_nowait, data)

    def start(self) -> None:
        self._stream.start()

    def stop(self) -> None:
        self._stream.stop()
        self._stream.close()


# ---------------------------------------------------------------------------
# ลำโพง: บัฟเฟอร์ AUDIO_OUTPUT_BUFFER_S วิก่อนเริ่มเล่น, เคลียร์ทันทีเมื่อโดนบาร์จอิน
# ---------------------------------------------------------------------------
class AudioPlayer:
    def __init__(self, buffer_seconds: float) -> None:
        self._buffer_bytes_needed = int(buffer_seconds * OUTPUT_RATE * 2)
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._stream: sd.RawOutputStream | None = None
        self.on_first_frame_played: Callable[[], None] | None = None  # เรียกครั้งเดียวตอนเริ่มเล่นจริง (วัด latency)
        self._fired_first_frame = False

    def feed(self, data: bytes) -> None:
        with self._lock:
            self._buf.extend(data)
            ready = self._stream is None and len(self._buf) >= self._buffer_bytes_needed
        if ready:
            self._start_stream()

    def _callback(self, outdata, frames, time_info, status) -> None:
        nbytes = frames * 2
        with self._lock:
            chunk = bytes(self._buf[:nbytes])
            del self._buf[:nbytes]
        if len(chunk) < nbytes:
            chunk += b"\x00" * (nbytes - len(chunk))
        outdata[:] = chunk
        if not self._fired_first_frame and any(chunk):
            self._fired_first_frame = True
            if self.on_first_frame_played:
                self.on_first_frame_played()

    def _start_stream(self) -> None:
        self._fired_first_frame = False
        self._stream = sd.RawOutputStream(
            samplerate=OUTPUT_RATE, channels=1, dtype="int16", callback=self._callback,
        )
        self._stream.start()

    def play_fallback_blocking(self, pcm: bytes) -> None:
        """เล่นประโยคสำรองแบบ blocking สั้น ๆ ตอน reconnect (ไม่ต้องผ่านคิว/บัฟเฟอร์ปกติ)"""
        self.stop()
        sd.play(np.frombuffer(pcm, dtype=np.int16), samplerate=OUTPUT_RATE, blocking=True)

    def stop(self) -> None:
        """เคลียร์บัฟ+หยุดเล่นทันที — ใช้ตอนบาร์จอินหรือจบ session"""
        with self._lock:
            self._buf.clear()
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None


# ---------------------------------------------------------------------------
# VAD: ต่อเนื่องทุกเฟรม 32ms คืน prob 0-1 (ไม่ใช้ VADIterator's start/end event เพราะเราต้องการ
# นับเวลาเงียบเองแยกจากตรรกะ "รอคำตอบอยู่ไหม" ด้วย)
# ---------------------------------------------------------------------------
class Vad:
    def __init__(self, threshold: float) -> None:
        self._model = load_silero_vad()
        self._threshold = threshold

    def is_speech(self, frame: bytes) -> bool:
        audio = torch.from_numpy(np.frombuffer(frame, dtype=np.int16).copy()).float() / 32768.0
        with torch.no_grad():
            prob = self._model(audio, INPUT_RATE).item()
        return prob >= self._threshold


# ---------------------------------------------------------------------------
# หนึ่งรอบสนทนา (หนึ่ง Gemini Live session) — เปิด, สตรีมเสียงเข้า-ออก, ปิดเองเมื่อเงียบเกิน timeout
# ---------------------------------------------------------------------------
class ConversationSession:
    def __init__(self, client: genai.Client, mic: MicSource, player: AudioPlayer, vad: Vad) -> None:
        self.client = client
        self.mic = mic
        self.player = player
        self.vad = vad
        self.silence_timeout = settings.VAD_SILENCE_TIMEOUT_S

    async def run(self, pre_roll: list[bytes]) -> None:
        """เปิด session, ส่ง pre_roll ก่อน แล้ววนสตรีมจนกว่าจะเงียบเกิน timeout"""
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=types.AudioTranscriptionConfig(),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            system_instruction=SYSTEM_INSTRUCTION,
            tools=[types.Tool(function_declarations=[SEARCH_FUNCTION])],
        )

        awaiting_response = False
        last_activity_ts = time.time()  # อัปเดตทุกครั้งที่มีเสียงพูดหรือคำตอบ ใช้คำนวณ idle timeout
        speech_end_ts: float | None = None
        turn_user_text = ""
        turn_cat_text = ""

        async with self.client.aio.live.connect(model=MODEL, config=config) as session:
            logger.info("[SESSION] เปิดแล้ว")

            for frame in pre_roll:
                await session.send_realtime_input(audio=types.Blob(data=frame, mime_type="audio/pcm;rate=16000"))

            async def mic_to_gemini() -> None:
                nonlocal awaiting_response, last_activity_ts, speech_end_ts
                was_speech = True  # เพิ่งเปิด session เพราะเจอเสียงพูด ถือว่ากำลังพูดอยู่
                while True:
                    frame = await self.mic.queue.get()
                    is_speech = self.vad.is_speech(frame)
                    await session.send_realtime_input(audio=types.Blob(data=frame, mime_type="audio/pcm;rate=16000"))

                    if is_speech:
                        # ถ้าผู้ใช้พูดแทรกตอนแมวกำลังพูด ปล่อยให้ Gemini เป็นคนส่ง interrupted กลับมาเอง
                        # (จัดการหยุดเล่นเสียงใน gemini_to_speaker) ฝั่งนี้แค่ track เวลาไว้เฉย ๆ
                        last_activity_ts = time.time()
                        speech_end_ts = None
                    elif was_speech and not is_speech:
                        speech_end_ts = time.time()
                        awaiting_response = True
                        logger.info("[VAD] พูดจบ รอคำตอบ...")

                    was_speech = is_speech

                    # เงียบเกิน timeout และไม่ได้รอคำตอบอยู่ (ไม่ใช่แค่เงียบระหว่างรอ Gemini คิด) -> ปิด session
                    if not awaiting_response and time.time() - last_activity_ts >= self.silence_timeout:
                        logger.info("[IDLE] เงียบเกิน %.1fs -> ปิด session", self.silence_timeout)
                        return

            async def gemini_to_speaker() -> None:
                nonlocal awaiting_response, last_activity_ts, turn_user_text, turn_cat_text
                async for response in session.receive():
                    if response.server_content and response.server_content.interrupted:
                        logger.info("[BARGE-IN] ผู้ใช้พูดแทรก -> หยุดเล่นเสียงทันที")
                        self.player.stop()
                        awaiting_response = False

                    if response.tool_call:
                        for fc in response.tool_call.function_calls:
                            q = fc.args.get("query", "")
                            t0 = time.perf_counter()
                            result_text = run_retrieval(q)
                            dt = time.perf_counter() - t0
                            logger.info("[TOOL] query=%r retrieval=%.3fs -> %d chars", q, dt, len(result_text))
                            await session.send_tool_response(function_responses=[
                                types.FunctionResponse(id=fc.id, name=fc.name, response={"result": result_text})
                            ])

                    if response.data is not None:
                        if speech_end_ts is not None:
                            def _log_latency(_ts=speech_end_ts) -> None:
                                logger.info("[LATENCY] พูดจบ -> ได้ยินเสียงแรก = %.3fs", time.time() - _ts)
                            self.player.on_first_frame_played = _log_latency
                        self.player.feed(response.data)

                    if response.server_content and response.server_content.input_transcription:
                        piece = response.server_content.input_transcription.text
                        if piece:
                            turn_user_text += piece
                    if response.server_content and response.server_content.output_transcription:
                        piece = response.server_content.output_transcription.text
                        if piece:
                            turn_cat_text += piece

                    if response.server_content and response.server_content.turn_complete:
                        logger.info("[TURN] ผู้ใช้: %r | แมว: %r", turn_user_text, turn_cat_text)
                        turn_user_text = ""
                        turn_cat_text = ""
                        awaiting_response = False
                        last_activity_ts = time.time()

            mic_task = asyncio.create_task(mic_to_gemini())
            gemini_task = asyncio.create_task(gemini_to_speaker())
            done, pending = await asyncio.wait({mic_task, gemini_task}, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            self.player.stop()
            logger.info("[SESSION] ปิดแล้ว")


# ---------------------------------------------------------------------------
# main loop: ฟังหา speech start ตลอดเวลา (นอก session) -> เปิด session -> วนซ้ำ พร้อม reconnect backoff
# ---------------------------------------------------------------------------
async def main() -> None:
    if not settings.GEMINI_API_KEY:
        logger.error("ไม่มี GEMINI_API_KEY ใน .env — ใส่ก่อนรัน")
        return

    loop = asyncio.get_running_loop()
    mic = MicSource(loop)
    player = AudioPlayer(buffer_seconds=settings.AUDIO_OUTPUT_BUFFER_S)
    vad = Vad(threshold=settings.VAD_SPEECH_THRESHOLD)
    fallback_pcm = ensure_fallback_audio()
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    mic.start()
    logger.info(
        "พร้อมแล้ว — พูดใส่ไมค์ได้เลย (VAD_SPEECH_THRESHOLD=%.2f, VAD_SILENCE_TIMEOUT_S=%.1f, "
        "AUDIO_OUTPUT_BUFFER_S=%.1f) Ctrl+C เพื่อหยุด",
        settings.VAD_SPEECH_THRESHOLD, settings.VAD_SILENCE_TIMEOUT_S, settings.AUDIO_OUTPUT_BUFFER_S,
    )

    backoff = 1.0
    try:
        while True:
            # --- ฟังหาจุดเริ่มพูด นอก session, เก็บ pre-roll กันคำแรกหาย ---
            pre_roll: list[bytes] = []
            speech_started = False
            while not speech_started:
                frame = await mic.queue.get()
                pre_roll.append(frame)
                if len(pre_roll) > PRE_ROLL_FRAMES:
                    pre_roll.pop(0)
                if vad.is_speech(frame):
                    speech_started = True
                    logger.info("[VAD] เจอเสียงพูดเริ่ม -> เปิด session")

            # --- เปิด session จริง พร้อม reconnect backoff ถ้าพัง ---
            try:
                session = ConversationSession(client, mic, player, vad)
                await session.run(pre_roll)
                backoff = 1.0  # สำเร็จรอบหนึ่งแล้ว รีเซ็ต backoff
            except (ClientError, ServerError, WebSocketException, ConnectionError, OSError) as exc:
                logger.warning("[RECONNECT] หลุดการเชื่อมต่อ: %s -> เล่นประโยคสำรอง รอ %.0fs แล้วลองใหม่", exc, backoff)
                player.play_fallback_blocking(fallback_pcm)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, settings.VOICE_RECONNECT_MAX_BACKOFF_S)
    except KeyboardInterrupt:
        pass
    finally:
        player.stop()
        mic.stop()
        logger.info("ปิดโปรแกรมเรียบร้อย")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
