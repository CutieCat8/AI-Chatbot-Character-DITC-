import { useEffect, useRef, useState } from "react";

/**
 * อ่านระดับเสียง (amplitude) แบบเรียลไทม์จาก <audio> element ผ่าน Web Audio API
 * คืนค่า 0-1 ให้ CatCharacter ใช้ขยับปาก (lip-flap) — วิธีนี้ตั้งใจใช้ "amplitude เฉย ๆ" ตามที่
 * Scope บอกไว้ (ไม่ต้อง viseme-accurate จริง "ไม่ต้องเป๊ะ") ไม่ใช่ lip-sync แบบวิเคราะห์หน่วยเสียง
 *
 * หมายเหตุ: AudioContext เริ่มทำงานได้ต้องมี user gesture ก่อน (ข้อจำกัดเบราว์เซอร์) — เรียก
 * resume() (คืนมาจาก hook นี้) ตอนคลิกปุ่มเล่นเสียง ไม่ใช่ตอน mount อัตโนมัติ
 */
export function useAmplitude(audioEl: HTMLAudioElement | null) {
  const [amplitude, setAmplitude] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const smoothedRef = useRef(0);

  useEffect(() => {
    if (!audioEl) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaElementSource(audioEl);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256; // ไม่ต้องละเอียดมาก แค่วัดพลังงานเสียงรวม ๆ พอ
    source.connect(analyser);
    analyser.connect(ctx.destination); // ต้องต่อไปลำโพงด้วย ไม่งั้นเสียงจะเงียบ (ทดสอบด้วยหูฟัง/ลำโพงจริง)

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let rafId: number;

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      // คำนวณ RMS (root mean square) จาก waveform — ตัวแทนพลังงานเสียง ณ ขณะนั้น
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const normalized = (buffer[i] - 128) / 128; // -1..1
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / buffer.length); // 0..~0.7 ปกติ

      // smoothing แบบ exponential moving average กันปากสั่นกระตุก (เสียงพูดจริงมีจังหวะเงียบสั้น ๆ
      // ระหว่างพยางค์ ถ้าไม่ smooth ปากจะกระพริบถี่เกินไปดูไม่เป็นธรรมชาติ)
      const target = Math.min(1, rms * 3.5); // ขยายสัญญาณ (เสียงพูดปกติ RMS ต่ำกว่า 1 มาก)
      smoothedRef.current += (target - smoothedRef.current) * 0.35;
      setAmplitude(smoothedRef.current);

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
      ctx.close();
    };
  }, [audioEl]);

  const resume = () => {
    void ctxRef.current?.resume();
  };

  return { amplitude, resume };
}
