"""
generate_dataset.py — สร้าง synthetic training data สำหรับ wake word "สวัสดี ditc"

ดู docs/superpowers/specs/2026-09-08-wake-word-design.md สำหรับ design เต็ม

ทั้งหมดสร้างจาก TTS (ไม่มีเสียงคนจริง) — เหตุผล: ไม่มีเวลา/คนอัดเสียงจริงหลายคนในตอนนี้ ยอมรับความ
เสี่ยงว่าความแม่นบนเสียงจริงยังไม่รู้จนกว่าจะทดสอบเฟส 3 (บันทึกไว้ใน spec แล้ว)

รัน: python generate_dataset.py --out <dir> [--quick]  (--quick = ชุดเล็กสำหรับทดสอบ pipeline ก่อน)
"""
from __future__ import annotations

import argparse
import asyncio
import random
import time
from pathlib import Path

import edge_tts
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SAMPLE_RATE = 16000  # ตรงกับ INPUT_SAMPLE_RATE ของ useVoiceSocket.ts (voice pipeline หลัก) — ใช้ค่า
# เดียวกันทั้งโปรเจกต์ กันความสับสนเรื่อง sample rate mismatch (เคยเป็นบั๊กมาก่อนในเรื่องอื่น)
CLIP_SECONDS = 2.0  # เดิม 1.6s (วัดจากคนพูดช้าสุด) เพิ่ม margin เป็น 2.0s ตามคำขอผู้ใช้ 2026-09-11
CLIP_SAMPLES = int(SAMPLE_RATE * CLIP_SECONDS)

VOICES = ["th-TH-NiwatNeural", "th-TH-PremwadeeNeural"]  # edge-tts มีแค่ 2 เสียงไทย (ชาย/หญิง) — ทั้งหมด

# วลี positive — รวมทั้งสองแบบการออกเสียง "ditc" ตามที่ตกลงกัน (ดี-ไอ-ที-ซี และ ดิตซี/ดิทซี)
POSITIVE_TEXTS = [
    "สวัสดีดีไอทีซี",
    "สวัสดี ดี ไอ ที ซี",
    "สวัสดีดิตซี",
    "สวัสดีดิทซี",
    "สวัสดีค่ะดีไอทีซี",
    "สวัสดีครับดีไอทีซี",
]

# negative — เน้นหนักเรื่อง "สวัสดี" เดี่ยวๆ/ไม่มี ditc ต่อท้าย (ตัวที่เจอบ่อยสุดในชีวิตจริง ต้องกัน
# false-accept จากตรงนี้เป็นอันดับหนึ่งตามที่ผู้ใช้ยืนยัน "เข้มงวดมาก")
NEGATIVE_GREETINGS = [
    "สวัสดีค่ะ",
    "สวัสดีครับ",
    "สวัสดีตอนเช้า",
    "สวัสดีทุกคน",
    "สวัสดีค่ะยินดีต้อนรับ",
    "สวัสดีครับผมชื่อดิว",
    "สวัสดีค่ะวันนี้อากาศดีนะคะ",
    "หวัดดีครับ",
    "สวัสดีค่ะดิฉันชื่อนิดค่ะ",
]

# ประโยคโดเมนใกล้เคียงของจริง (จาก docs/knowledge-base-audit.md — คำถามที่ใช้ทดสอบ RAG จริง) + คำถาม
# ทั่วไปเกี่ยวกับ CAMT/DITC ที่ไม่ใช่ wake word — กันเคส "คุยเรื่อง DITC แต่ไม่ได้พูด wake word" เด้งผิด
NEGATIVE_DOMAIN = [
    "ค่าเทอมสาขาวิศวกรรมซอฟต์แวร์เท่าไหร่",
    "DITC เปิดกี่โมง",
    "เบอร์โทรติดต่อ CAMT คืออะไร",
    "อยากเป็น software developer ต้องเรียนอะไร",
    "คณะ CAMT มีปริญญาเอกไหม",
    "เอกสารสมัครเรียนมีอะไรบ้าง",
    "ศูนย์ดิตซีอยู่ตรงไหนของมหาวิทยาลัย",
    "ดิตซีทำโครงการอะไรบ้าง",
    "ขอข้อมูลเกี่ยวกับสาขาแอนิเมชันหน่อย",
    "จบแล้วทำงานอะไรได้บ้าง",
]

# ประโยคไทยทั่วไป ไม่เกี่ยวกับ DITC เลย (จำลองคนเดินผ่านคุยกันในที่สาธารณะ)
NEGATIVE_RANDOM = [
    "วันนี้กินข้าวหรือยัง",
    "รถเมล์สายนี้ไปไหนคะ",
    "เดี๋ยวเจอกันตอนเย็นนะ",
    "อากาศร้อนมากเลยวันนี้",
    "ขอโทษนะครับรบกวนถามทาง",
    "พรุ่งนี้มีประชุมกี่โมง",
    "ร้านนี้อร่อยไหม",
    "ขอบคุณมากค่ะ",
    "ไปไหนมาคะเมื่อกี้",
    "โทรศัพท์แบตหมดแล้ว",
]

RATE_VARIANTS = ["-15%", "-5%", "+0%", "+10%", "+20%"]
PITCH_VARIANTS = ["-20Hz", "+0Hz", "+20Hz"]


async def _synth_one(text: str, voice: str, rate: str, pitch: str, out_path: Path) -> None:
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await communicate.save(str(out_path))


async def _synth_batch(
    jobs: list[tuple[str, str, str, str, Path]], concurrency: int = 2, retries: int = 3
) -> None:
    """Synthesize conservatively: edge-tts is a remote, unofficial service.

    A transient empty response must not cancel the other jobs silently.  We retry
    each job with exponential backoff and then report every failed input so it is
    reproducible rather than training on an accidentally incomplete dataset.
    """
    sem = asyncio.Semaphore(concurrency)
    failures: list[tuple[str, str, str, str, Exception]] = []

    def valid_audio(path: Path) -> bool:
        try:
            return path.is_file() and path.stat().st_size > 0 and sf.info(str(path)).frames > 0
        except Exception:
            return False

    async def _run(job: tuple[str, str, str, str, Path]) -> None:
        text, voice, rate, pitch, out_path = job
        async with sem:
            # A resumed full run reuses only a file that libsndfile can decode.
            # This makes long, rate-limited TTS jobs restartable without trusting
            # a corrupt partial MP3.
            if valid_audio(out_path):
                return
            for attempt in range(1, retries + 1):
                try:
                    # A stale partial file from a failed request must never be
                    # mistaken for a successful cached clip on the next run.
                    out_path.unlink(missing_ok=True)
                    await _synth_one(text, voice, rate, pitch, out_path)
                    if out_path.stat().st_size == 0:
                        raise RuntimeError("edge-tts wrote an empty audio file")
                    # Some failed responses have a non-zero MP3 container but
                    # no decodable frames; catch those here, before training.
                    if sf.info(str(out_path)).frames <= 0:
                        raise RuntimeError("edge-tts wrote audio with no frames")
                    return
                except Exception as exc:  # edge-tts has several transport exception types
                    out_path.unlink(missing_ok=True)
                    if attempt == retries:
                        failures.append((text, voice, rate, pitch, exc))
                    else:
                        delay = 1.5 * (2 ** (attempt - 1))
                        print(
                            f"retry {attempt}/{retries - 1}: text={text!r}, voice={voice}, "
                            f"rate={rate}, pitch={pitch}; {exc!s}. Waiting {delay:.1f}s"
                        )
                        await asyncio.sleep(delay)

    await asyncio.gather(*[_run(j) for j in jobs])
    if failures:
        details = "\n".join(
            f"  text={text!r}, voice={voice}, rate={rate}, pitch={pitch}: {exc}"
            for text, voice, rate, pitch, exc in failures
        )
        raise RuntimeError(
            f"edge-tts failed for {len(failures)}/{len(jobs)} clips after {retries} attempts:\n{details}"
        )


def _mp3_to_padded_wav_array(mp3_path: Path) -> np.ndarray:
    """edge-tts เซฟเป็น mp3 — อ่านกลับมาเป็น PCM float32, resample เป็น SAMPLE_RATE, pad/truncate ให้
    ยาวคงที่ CLIP_SAMPLES (โมเดล KWS ส่วนใหญ่ใช้ input ยาวคงที่ ง่ายกว่าจัดการ variable-length)"""
    data, sr = sf.read(str(mp3_path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)  # mp3 อาจเป็น stereo — ย่อเป็น mono
    if sr != SAMPLE_RATE:
        data = resample_poly(data, SAMPLE_RATE, sr).astype(np.float32)
    return _pad_or_truncate(data)


def _pad_or_truncate(data: np.ndarray) -> np.ndarray:
    if len(data) >= CLIP_SAMPLES:
        # เสียงพูดจริงมักอยู่ต้นคลิป (TTS ไม่มี silence นำหน้ายาว) ตัดท้ายพอ
        return data[:CLIP_SAMPLES]
    pad = np.zeros(CLIP_SAMPLES - len(data), dtype=np.float32)
    return np.concatenate([data, pad])


def _random_time_shift(data: np.ndarray, max_shift_ratio: float = 0.15) -> np.ndarray:
    """เลื่อนตำแหน่งเสียงพูดในหน้าต่างคงที่แบบสุ่ม — จำลองว่าคนไม่ได้เริ่มพูดตรงขอบ frame เป๊ะเสมอ
    (สำคัญมากสำหรับ inference จริงที่ sliding window ไม่มีทางตรงจังหวะเป๊ะ)"""
    max_shift = int(len(data) * max_shift_ratio)
    if max_shift == 0:
        return data
    shift = random.randint(-max_shift, max_shift)
    if shift == 0:
        return data
    if shift > 0:
        return np.concatenate([np.zeros(shift, dtype=np.float32), data[:-shift]])
    return np.concatenate([data[-shift:], np.zeros(-shift, dtype=np.float32)])


def _mix_noise(data: np.ndarray, snr_db: float) -> np.ndarray:
    """ผสม synthetic colored noise (จำลองเสียงรบกวนพื้นหลังหน้าบูธ/ทางเดิน) ที่ระดับ SNR กำหนด —
    ไม่มีไฟล์เสียงรบกวนจริงให้ใช้ตอนนี้ ใช้ noise สังเคราะห์แทน (แจ้งไว้ใน spec แล้วว่าเป็นข้อจำกัด)"""
    noise = np.random.randn(len(data)).astype(np.float32)
    # pink-ish noise คร่าวๆ: กรองความถี่สูงออกบางส่วนด้วยการเฉลี่ยเคลื่อนที่สั้นๆ (เร็วกว่า proper FFT filter
    # พอสำหรับ augmentation ไม่ต้องแม่นยำระดับ acoustically-correct)
    kernel = np.ones(5) / 5
    noise = np.convolve(noise, kernel, mode="same")

    signal_power = np.mean(data**2) + 1e-10
    noise_power = np.mean(noise**2) + 1e-10
    target_noise_power = signal_power / (10 ** (snr_db / 10))
    noise = noise * np.sqrt(target_noise_power / noise_power)
    mixed = data + noise
    return np.clip(mixed, -1.0, 1.0)


def _augment_variants(base: np.ndarray, n: int) -> list[np.ndarray]:
    """สร้าง n เวอร์ชัน augmented จากคลิปฐาน 1 คลิป — สุ่มรวม time-shift + noise ที่ SNR ต่างกัน +
    volume scaling เล็กน้อย"""
    out = []
    snr_choices = [30.0, 20.0, 12.0, 6.0]  # เนียนสนิทถึงรบกวนพอสมควร — ไม่เอาแย่มากเกินจริง (ไม่งั้นแม้แต่
    # หูคนก็ฟังไม่รู้เรื่อง โมเดลไม่ควรถูกบังคับให้เรียนรู้เคสที่คนจริงก็แยกไม่ออก)
    for _ in range(n):
        v = _random_time_shift(base)
        v = v * random.uniform(0.7, 1.15)
        v = np.clip(v, -1.0, 1.0)
        v = _mix_noise(v, random.choice(snr_choices))
        out.append(v.astype(np.float32))
    return out


def _generate_silence_noise_clips(n: int) -> list[np.ndarray]:
    """คลิป negative ที่ไม่มีเสียงพูดเลย (เงียบ + เสียงรบกวนพื้นหลังล้วนๆ) — กันโมเดล false-accept ตอน
    ไม่มีใครพูดอะไรเลย"""
    out = []
    for _ in range(n):
        base = np.zeros(CLIP_SAMPLES, dtype=np.float32)
        snr = random.choice([40.0, 25.0, 15.0])  # เงียบสนิทถึงมีเสียงรบกวนพื้นหลังบ้าง
        out.append(_mix_noise(base, snr))
    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--quick", action="store_true", help="ชุดเล็กสำหรับทดสอบ pipeline ก่อน (เร็ว)")
    parser.add_argument("--concurrency", type=int, default=2, help="TTS requests in flight (default: 2)")
    parser.add_argument("--retries", type=int, default=3, help="attempts per TTS clip (default: 3)")
    parser.add_argument("--seed", type=int, default=20260908, help="random seed for reproducible augmentation")
    args = parser.parse_args()
    if args.concurrency < 1 or args.retries < 1:
        parser.error("--concurrency and --retries must both be at least 1")
    random.seed(args.seed)
    np.random.seed(args.seed)

    out_dir: Path = args.out
    raw_dir = out_dir / "_raw_tts"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "positive").mkdir(parents=True, exist_ok=True)
    (out_dir / "negative").mkdir(parents=True, exist_ok=True)

    # ไม่ใช้ cartesian product เต็ม (5 rate x 3 pitch = 15 ต่อข้อความ) — edge-tts เป็น network call ต่อ
    # คลิป ยิงเยอะเกินไปช้า/เสี่ยง rate-limit โดยไม่ได้ diversity เพิ่มคุ้มค่าเท่า augmentation ทางตัวเลข
    # (time-shift/noise/volume) ที่ทำทีหลังอยู่แล้ว — 3 rate x 2 pitch = 6 ต่อข้อความ พอสมดุล
    rate_variants = RATE_VARIANTS[:2] if args.quick else RATE_VARIANTS[::2]  # 5 -> 3 (skip ทุกตัวที่ 2)
    pitch_variants = PITCH_VARIANTS[:1] if args.quick else PITCH_VARIANTS[:2]  # 3 -> 2
    positive_texts = POSITIVE_TEXTS[:2] if args.quick else POSITIVE_TEXTS
    negative_texts = (
        (NEGATIVE_GREETINGS[:3] + NEGATIVE_DOMAIN[:2] + NEGATIVE_RANDOM[:2])
        if args.quick
        else (NEGATIVE_GREETINGS + NEGATIVE_DOMAIN + NEGATIVE_RANDOM)
    )
    augments_per_base = 2 if args.quick else 6

    # --- 1) synthesize TTS base clips (positive + negative text) ---
    jobs: list[tuple[str, str, str, str, Path]] = []
    job_meta: list[tuple[str, Path]] = []  # (label, mp3_path)

    def add_jobs(texts: list[str], label: str) -> None:
        for i, text in enumerate(texts):
            for voice in VOICES:
                for rate in rate_variants:
                    for pitch in pitch_variants:
                        mp3_path = raw_dir / f"{label}_{i}_{voice}_{rate}_{pitch}.mp3".replace("%", "pct")
                        jobs.append((text, voice, rate, pitch, mp3_path))
                        job_meta.append((label, mp3_path))

    add_jobs(positive_texts, "positive")
    add_jobs(negative_texts, "negative")

    print(f"synthesizing {len(jobs)} TTS base clips via edge-tts ...")
    started = time.monotonic()
    await _synth_batch(jobs, concurrency=args.concurrency, retries=args.retries)
    print(f"done synthesizing in {time.monotonic() - started:.1f}s.")

    # --- 2) load + augment each base clip, write final WAVs ---
    pos_count = 0
    neg_count = 0
    for label, mp3_path in job_meta:
        base = _mp3_to_padded_wav_array(mp3_path)
        variants = _augment_variants(base, augments_per_base)
        stem = mp3_path.stem
        for j, v in enumerate(variants):
            target_dir = out_dir / label
            sf.write(str(target_dir / f"{stem}_aug{j}.wav"), v, SAMPLE_RATE, subtype="PCM_16")
            if label == "positive":
                pos_count += 1
            else:
                neg_count += 1

    # --- 3) pure silence/noise negatives (no TTS needed) ---
    n_noise = 40 if args.quick else 200
    for i, clip in enumerate(_generate_silence_noise_clips(n_noise)):
        sf.write(str(out_dir / "negative" / f"noise_{i}.wav"), clip, SAMPLE_RATE, subtype="PCM_16")
        neg_count += 1

    print(f"positive clips: {pos_count}")
    print(f"negative clips: {neg_count}")
    print(f"saved to {out_dir}")


if __name__ == "__main__":
    asyncio.run(main())
