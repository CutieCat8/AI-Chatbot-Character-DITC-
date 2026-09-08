/**
 * useVoiceSocket.test.ts — เทสตรรกะ "จัดคิวเสียงตอบ" (scheduleChunk/computeChunkSchedule) ที่เป็น
 * สาเหตุของบั๊กเสียงติ๊ก/ป็อบแทรกระหว่างแมวพูด (ดู CLAUDE.md หัวข้อ "เสียงติ๊ก/ป็อบแทรกระหว่างแมวพูด")
 *
 * ประวัติสั้นๆ (2026-09-08): รอบแรกเดาว่าสาเหตุคือลูป flush ตอนเทิร์นเริ่ม (origin=flush) เลยใส่
 * margin แค่จุดนั้น — ผิด เก็บ diagnostic logging จริงจากผู้ใช้ทดสอบบน Mac แล้วพบว่า gap ที่เกิดจริง
 * ทั้งหมดเป็น origin=stream (schedule ทีละก้อนตอนรับผ่าน WS ระหว่างเทิร์น) ไม่มี origin=flush เลยสัก
 * ครั้ง จึงย้าย margin ไปใส่ใน computeChunkSchedule ตรงๆ (ครอบทุก origin) แทน — ดู
 * CHUNK_RECOVERY_MARGIN_MS ในไฟล์จริงสำหรับรายละเอียดเต็ม
 *
 * ⚠️ สิ่งที่เทสชุดนี้พิสูจน์ได้ / พิสูจน์ไม่ได้ (ตามกติกา CLAUDE.md ข้อ 1 — ห้ามอ้างว่า "ทดสอบแล้ว"
 * ถ้าไม่ได้ทดสอบด้วยของจริง):
 *   - พิสูจน์ได้: ตรรกะคำนวณเวลาเริ่มเล่นก้อนเสียงถัดไป (computeChunkSchedule) ถูกต้องตามที่ตั้งใจ
 *     ในทุกกรณีขอบ (contiguous / late-arrival / recovery margin) โดยใช้ตัวเลข gap จริงบางส่วนจาก
 *     diagnostic logging (5.8/40.6/69.6/75.4ms) เป็นฐาน ไม่ใช่ค่าสมมติทั้งหมด
 *   - พิสูจน์ไม่ได้: ว่าเสียงติ๊ก/ป็อบที่ได้ยินจริงหายไปหรือยังหลังใส่ margin — เทสนี้ไม่ได้เล่นเสียงเลย
 *     เป็นแค่เทสตรรกะเลข ต้องทดสอบซ้ำด้วยหูจริง+diagnostic logging อีกรอบ (ดู
 *     docs/click-noise-manual-test-plan.md) ก่อนสรุปว่าดีขึ้นหรือแย่ลง
 *
 * เทสกลุ่ม "batch-flush จำลอง processing lag" ด้านล่าง เป็นสมมติฐานเดิมที่รู้แล้วว่าไม่ตรงกับ
 * mechanism จริง — เก็บไว้เป็น regression coverage ของตรรกะทั่วไปเท่านั้น (ดูหมายเหตุใน describe เอง)
 */
import { describe, expect, it } from "vitest";
import { computeChunkSchedule, floatTo16BitPCM, pcm16ToFloat32, rmsOf } from "./useVoiceSocket";

describe("floatTo16BitPCM / pcm16ToFloat32 roundtrip", () => {
  it("แปลงไป-กลับได้ค่าใกล้เคียงเดิม (คลาดเคลื่อนได้แค่ระดับ quantization ของ int16)", () => {
    const original = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25, -0.75]);
    const roundtripped = pcm16ToFloat32(floatTo16BitPCM(original));
    for (let i = 0; i < original.length; i++) {
      expect(roundtripped[i]).toBeCloseTo(original[i], 3);
    }
  });

  it("clamp ค่าที่เกินช่วง [-1, 1] แทนที่จะ overflow", () => {
    const clipped = pcm16ToFloat32(floatTo16BitPCM(new Float32Array([2, -2])));
    expect(clipped[0]).toBeCloseTo(1, 3);
    expect(clipped[1]).toBeCloseTo(-1, 3);
  });
});

describe("rmsOf", () => {
  it("เงียบสนิท (ทุกค่า 0) ต้องได้ RMS = 0", () => {
    expect(rmsOf(new Float32Array([0, 0, 0, 0]))).toBe(0);
  });

  it("สัญญาณคงที่ต้องได้ RMS เท่ากับ |ค่านั้น|", () => {
    expect(rmsOf(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 6);
    expect(rmsOf(new Float32Array([-0.3, -0.3]))).toBeCloseTo(0.3, 6);
  });

  it("สัญญาณสลับ +1/-1 ต้องได้ RMS = 1 (ไม่หักล้างกันเป็น 0)", () => {
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 6);
  });
});

describe("computeChunkSchedule — เคสปกติ (ไม่มี jitter)", () => {
  it("prevNextPlayTime=0 ชนกับ now ที่ไกลออกไปมาก (เคสสมมติทางคณิตศาสตร์ล้วนๆ ไม่ใช่สิ่งที่เกิดจริงในแอป — enqueueAudio จริงจะ set nextPlayTimeRef.current = audioCtx.currentTime ก่อนเรียก scheduleChunk ก้อนแรกเสมอ ดู useVoiceSocket.ts) เริ่มที่ now ทันที และ hadGap=true ตามนิยามฟังก์ชัน (ผู้เรียกต้องไม่ตีความ hadGap ของก้อนแรกจริงในแอปเป็นบั๊ก เพราะ prevNextPlayTime กับ now ใกล้กันมากตั้งแต่ต้น)", () => {
    const result = computeChunkSchedule(0, 10, 0.5);
    expect(result.startTime).toBe(10);
    expect(result.nextPlayTime).toBe(10.5);
    expect(result.hadGap).toBe(true);
  });

  it("ก้อนถัดไปที่มาตรงเวลาพอดี (now == prevNextPlayTime) ต้องต่อกันสนิท ไม่มีช่องว่าง", () => {
    const result = computeChunkSchedule(10.5, 10.5, 0.5);
    expect(result.startTime).toBe(10.5);
    expect(result.nextPlayTime).toBe(11);
    expect(result.hadGap).toBe(false);
  });

  it("ก้อนที่มาเร็วกว่ากำหนด (now < prevNextPlayTime — คิวยังไม่ทันเล่นหมด) ต้องเริ่มต่อจากคิวเดิม ไม่ใช่ now", () => {
    const result = computeChunkSchedule(20, 15, 2);
    expect(result.startTime).toBe(20); // ยึด prevNextPlayTime ไม่ใช่ now — ห้ามเล่นซ้อนทับก้อนก่อนหน้า
    expect(result.nextPlayTime).toBe(22);
    expect(result.hadGap).toBe(false);
  });
});

describe("computeChunkSchedule — เคส late-arrival (ต้องสงสัยของบั๊กเสียงติ๊ก/ป็อบ)", () => {
  it("ก้อนที่มาช้ากว่ากำหนด (now > prevNextPlayTime) ต้องเลื่อนไปเริ่มที่ now และรายงาน hadGap=true", () => {
    // จำลองเคส "ช่องว่างเล็ก 10-70ms" ที่ CLAUDE.md อ้างถึงจาก log จริง
    const prevNextPlayTime = 10.0;
    const now = 10.03; // สาย 30ms
    const result = computeChunkSchedule(prevNextPlayTime, now, 0.5);
    expect(result.startTime).toBe(now);
    expect(result.hadGap).toBe(true);
    expect(result.startTime - prevNextPlayTime).toBeCloseTo(0.03, 6); // ขนาดช่องว่างจริง = 30ms
  });

  it("ยิ่งสายมาก ช่องว่างยิ่งใหญ่ตามสัดส่วน (ไม่ใช่ค่าคงที่ตายตัว)", () => {
    const r1 = computeChunkSchedule(10.0, 10.01, 0.5);
    const r2 = computeChunkSchedule(10.0, 10.09, 0.5);
    const gap1 = r1.startTime - 10.0;
    const gap2 = r2.startTime - 10.0;
    expect(gap2).toBeGreaterThan(gap1);
  });
});

describe("computeChunkSchedule — จำลอง batch-flush ตอนเทิร์นเริ่ม (สมมติฐาน root cause เดิม — ยืนยันแล้วว่า 'ผิด' ด้วย diagnostic logging จริง 2026-09-08: gap จริงทั้งหมดเป็น origin=stream ไม่ใช่ origin=flush — เก็บเทสกลุ่มนี้ไว้เป็น regression coverage ของตรรกะทั่วไป ไม่ใช่หลักฐานสนับสนุนสาเหตุนี้อีกต่อไป)", () => {
  /** จำลองลูป flush jitter buffer ใน enqueueAudio: schedule หลายก้อนติดกัน โดยแต่ละครั้งที่เรียก
   * computeChunkSchedule "เวลาจริง" (now) ไหลไปแล้วเท่ากับ processingTimePerChunk วินาที (จำลอง
   * ต้นทุนจริงของการสร้าง AudioBuffer + copyToChannel + connect ต่อก้อน) — ไม่ใช่ค่าจากอุปกรณ์จริง
   * เป็นค่าสมมติสำหรับพิสูจน์ตรรกะเท่านั้น (⚠️ ไม่ใช่ mechanism ที่เกิดจริงตามหลักฐาน — ดู describe
   * ถัดไป "recovery margin" สำหรับตัวเลขที่อิงหลักฐานจริง) */
  function simulateBatchFlush(chunkDurations: number[], processingTimePerChunk: number) {
    let now = 0;
    let nextPlayTime = 0; // enqueueAudio ตั้ง nextPlayTimeRef.current = audioCtx.currentTime ตอนเริ่ม flush
    const gaps: number[] = [];
    for (const duration of chunkDurations) {
      const result = computeChunkSchedule(nextPlayTime, now, duration);
      if (result.hadGap) gaps.push(result.startTime - nextPlayTime);
      nextPlayTime = result.nextPlayTime;
      now += processingTimePerChunk; // เวลาจริงไหลต่อก่อนจะ schedule ก้อนถัดไป
    }
    return { gaps, gapCount: gaps.length };
  }

  it("processing time ต่อก้อนเร็วกว่าความยาวเสียงมาก (เคสปกติ) ต้องไม่มีช่องว่างเลย", () => {
    // ก้อนเสียง 40ms ต่อก้อน (ทั่วไปสำหรับ PCM chunk ขนาดเล็กจาก Gemini Live) ประมวลผลแค่ 1ms/ก้อน
    const chunks = Array(20).fill(0.04);
    const { gapCount } = simulateBatchFlush(chunks, 0.001);
    expect(gapCount).toBe(0);
  });

  it("processing time ต่อก้อนช้ากว่าความยาวเสียงสะสม (เครื่องแรงไม่พอ/มีงานอื่นแทรก) ต้องเกิดช่องว่างซ้ำหลายครั้ง — ตรงกับ log จริงที่ CLAUDE.md อ้างถึง (10-70ms หลายครั้งในเทิร์นเดียว)", () => {
    // ก้อนเสียงสั้น 20ms/ก้อน แต่ประมวลผลกิน 25ms/ก้อน (จำลองเครื่องที่ตามไม่ทัน) — deficit สะสมทุกก้อน
    const chunks = Array(10).fill(0.02);
    const { gaps, gapCount } = simulateBatchFlush(chunks, 0.025);
    expect(gapCount).toBeGreaterThan(1); // เกิดซ้ำหลายครั้ง ไม่ใช่แค่ก้อนเดียว
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(0.1); // อยู่ในสเกล <100ms ต่อครั้ง — สอดคล้องกับที่ log จริงเจอ (10-70ms)
    }
  });

  it("processing time ต่อก้อนพอดีกับความยาวเสียง (ก้ำกึ่ง) ต้องไม่มีช่องว่างสะสมยาวขึ้นเรื่อย ๆ", () => {
    const chunks = Array(15).fill(0.03);
    const { gaps } = simulateBatchFlush(chunks, 0.03);
    // ก้ำกึ่งพอดี (now == prevNextPlayTime ทุกครั้ง) ไม่ควรมี gap เลยตามนิยาม hadGap (< ไม่ใช่ <=)
    expect(gaps.length).toBe(0);
  });
});

describe("computeChunkSchedule — recovery margin (ทดลองแก้บั๊กเสียงติ๊ก/ป็อบ, ใส่ทุกครั้งที่ hadGap ทุก origin)", () => {
  /** รอบแรก (ก่อนหน้านี้ในวันเดียวกัน) เคยลองใส่ margin แค่ตอน flush ก้อนแรกของเทิร์นเท่านั้น เพราะเดา
   * ว่าสาเหตุคือลูป synchronous ตอนเทิร์นเริ่ม — พอเก็บ diagnostic logging จริงจากผู้ใช้ทดสอบบน Mac
   * (2026-09-08 บ่าย) พบว่า **gap ทั้งหมดที่เจอเป็น origin=stream ล้วนๆ ไม่มี origin=flush เลย** จึงย้าย
   * มาใส่ margin ใน computeChunkSchedule ตรงๆ (ครอบทุก origin) แทน — ตัวเลข deficit ที่ใช้จำลองด้านล่าง
   * อิงจากขนาด gap จริงที่เจอในเทสนั้น (ตัดกลุ่มใหญ่ที่เป็นความเงียบระหว่างเทิร์นทิ้ง เพราะไม่มีใครได้ยิน):
   * 5.8ms, 40.6ms, 69.6ms, 75.4ms — ไม่ใช่ค่าจากอุปกรณ์จริงทุกกรณี (บางเคสยังเป็นค่าสมมติเพื่อขอบเขต)
   */
  const REAL_GAPS_MS = [5.8, 40.6, 69.6, 75.4]; // จาก console log จริงของผู้ใช้ (ดู CLAUDE.md)

  it("gap เล็กกว่า margin (5.8ms < 10ms) — hadGap ยังเป็น true เหมือนเดิม (margin ไม่ทำให้ 'ไม่นับเป็น gap') แค่ startTime เลื่อนออกไปตาม margin เต็มจำนวน", () => {
    // จำลองสถานการณ์เดียว ไม่ใช่ loop สะสม (ตรงกับ origin=stream จริง ที่แต่ละก้อนมาจาก WS message แยกกัน
    // ไม่ใช่ synchronous loop ต่อเนื่องแบบ batch-flush)
    const prevNextPlayTime = 10.0;
    const now = 10.0 + 0.0058; // deficit 5.8ms ตรงกับที่เจอจริง
    const withoutMargin = computeChunkSchedule(prevNextPlayTime, now, 0.1, 0);
    const withMargin = computeChunkSchedule(prevNextPlayTime, now, 0.1, 0.01);
    expect(withoutMargin.hadGap).toBe(true); // deficit จริงเกิดขึ้น (ตรวจก่อน margin เข้ามาเกี่ยว)
    expect(withMargin.hadGap).toBe(true); // hadGap ตัดสินก่อนใส่ margin เสมอ — margin ไม่ทำให้ "ไม่นับเป็น gap" แค่ทำให้ recovery มี lead time
    expect(withMargin.startTime - withoutMargin.startTime).toBeCloseTo(0.01, 6); // margin ถูกบวกเข้าไปเต็มจำนวน
  });

  it("gap ใหญ่กว่า margin มาก (69.6ms > 10ms) — margin ยังช่วยลด 'ความถี่ของ gap ถัดไป' ได้ แม้ครั้งนี้ยังเกิด", () => {
    // จำลอง 2 ก้อนติดกัน: ก้อนแรก deficit 69.6ms (เกิด gap แน่นอน) ก้อนสองมาถึงจริงหลังก้อนแรก 108ms
    // (=100ms duration ของก้อนแรก + 8ms ดีเลย์เพิ่มจากเครือข่าย) — เวลาที่ก้อนสอง "มาถึงจริง" (now2)
    // เป็นค่า absolute ที่ไม่ขึ้นกับว่าเราเลือกใช้ margin หรือไม่ (มาจากฝั่ง backend/เครือข่าย ไม่ใช่
    // ฝั่งเรา) — ต่างจาก prevNextPlayTime ของก้อนสองที่ได้รับผลจาก margin ของก้อนแรกโดยตรง
    const now1 = 10.0 + 0.0696; // เวลาที่ก้อนแรกมาถึงจริง (deficit 69.6ms จาก baseline 10.0)
    const now2 = now1 + 0.1 + 0.008; // ก้อนสองมาถึงจริง 108ms หลังก้อนแรก (ไม่ขึ้นกับ margin)

    const withoutMargin = (() => {
      const r1 = computeChunkSchedule(10.0, now1, 0.1, 0);
      const r2 = computeChunkSchedule(r1.nextPlayTime, now2, 0.1, 0);
      return [r1.hadGap, r2.hadGap];
    })();
    const withMargin = (() => {
      const r1 = computeChunkSchedule(10.0, now1, 0.1, 0.01);
      const r2 = computeChunkSchedule(r1.nextPlayTime, now2, 0.1, 0.01);
      return [r1.hadGap, r2.hadGap];
    })();
    expect(withoutMargin).toEqual([true, true]); // ไม่มี margin — gap ซ้ำทั้งสองก้อน (ก้อนสอง deficit 8ms)
    expect(withMargin).toEqual([true, false]); // มี margin — ก้อนแรกยัง gap (69.6ms > 10ms margin) แต่ margin ที่บวกเข้า nextPlayTime ของก้อนแรกดูดซับ deficit 8ms ของก้อนสองได้พอดี
  });

  it("gap ที่เจอจริงทุกขนาด (5.8/40.6/69.6/75.4ms) — margin ไม่ทำให้ 'หายเป็นศูนย์' แต่ startTime เลื่อนออกไปตาม margin เป๊ะทุกครั้งที่ hadGap", () => {
    for (const gapMs of REAL_GAPS_MS) {
      const prev = 10.0;
      const now = 10.0 + gapMs / 1000;
      const withoutMargin = computeChunkSchedule(prev, now, 0.1, 0);
      const withMargin = computeChunkSchedule(prev, now, 0.1, 0.01);
      expect(withoutMargin.hadGap).toBe(true);
      expect(withMargin.startTime).toBeCloseTo(withoutMargin.startTime + 0.01, 6);
    }
  });

  it("margin ไม่กระทบเคสที่ไม่มี gap อยู่แล้วเลย (chunk มาตรงเวลาปกติ)", () => {
    const result = computeChunkSchedule(10.5, 10.3, 0.2, 0.01); // now < prevNextPlayTime อยู่แล้ว ไม่มี deficit
    expect(result.hadGap).toBe(false);
    expect(result.startTime).toBe(10.5); // ไม่ถูก margin แตะเลย
  });
});
