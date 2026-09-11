import { useCallback, useEffect, useRef, useState } from "react";
import type { CatState } from "../types";

const INPUT_SAMPLE_RATE = 16000; // Gemini Live รับเสียงเข้าที่ 16kHz PCM16 mono
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live ส่งเสียงตอบกลับมาที่ 24kHz PCM16 mono
const JITTER_BUFFER_MS = 1500; // ตกลงกันไว้ตอนทำ backend (ดู voice_test.html/voice_pipeline_dev.py)
export const LOCAL_VAD_RMS_THRESHOLD = 0.02; // ใช้ตัดสิน speech_start/speech_end ที่ส่งให้ backend จริง (ดู onaudioprocess) — export ไว้ให้ debug overlay อ้างค่าเดียวกัน ไม่ต้อง hardcode ซ้ำ
const SILENCE_HANGOVER_MS = 500; // ต้องเงียบต่อเนื่องแค่ไหนถึงถือว่าพูดจบ กันตัดกลางคำที่มีช่วงเว้นวรรค/หายใจสั้น ๆ
// ต้องเงียบต่อเนื่องแค่ไหนถึงจะยอมสลับ UI จาก "listening" ไป "thinking" (ค่าเดียวจุดเดียว ปรับที่นี่
// พอ ไม่ต้อง hardcode กระจาย) — แยกจาก SILENCE_HANGOVER_MS ข้างบนโดยตั้งใจ: ตัวนั้นคุมว่าเมื่อไหร่จะ
// ส่ง speech_end ให้ backend จริง (ต้องไวพอสมควรเพื่อไม่ให้ Gemini รอนาน) ส่วนตัวนี้คุมแค่ "ตา/หู" บน
// จอ ไม่ให้รีสตาร์ตกลางประโยคทุกครั้งที่เว้นหายใจสั้น ๆ (0.1-0.2s) ระหว่างพูด — ยาวกว่าเพราะไม่กระทบ
// การสนทนาจริง แค่กระทบว่าดูลื่นไหลแค่ไหน (พบจริงจากทดสอบเสียงจริง 2026-09-08: ค่าเดิมที่ไม่มี
// hangover เลยทำให้ตากรอกรีเซ็ต/หูพับใหม่ทุกครั้งที่เว้นวรรคแม้แต่นิดเดียว)
const LISTENING_HANGOVER_MS = 900;
// ต้องเห็น !isBotSpeaking() ต่อเนื่องนานแค่ไหนก่อนยอมรับว่าแมวพูดจบเทิร์นจริง ๆ (ค่าเดียวจุดเดียว
// ปรับที่นี่พอ) — คุมแค่จังหวะเคลียร์ offTopic + เปลี่ยน wake -> transition -> idle ใน tick() เท่านั้น
// ไม่กระทบ ws.onclose ที่ต้องเคลียร์ทันทีเสมอ (WS หลุดจริงไม่ใช่แค่ช่องว่างในคิวเสียง)
//
// เจอจริงจาก log ผู้ใช้ทดสอบ (2026-09-08): คิวเสียงที่ต่อกันเป็นก้อน ๆ (scheduleChunk คนละก้อน) มีช่อง
// ว่างจริงระหว่างก้อนสั้นแค่ ~7ms (nextPlayTimeRef คลาดกับ ctxTime นิดเดียว) ก่อนก้อนถัดไปจะเริ่มเล่น
// ต่ออีก ~90ms ถัดมา — tick() วิ่งที่ ~60fps (เร็วกว่าจังหวะนี้มาก) เห็นช่องว่างนั้นพอดีเฟรมเดียวแล้ว
// เข้าใจผิดว่าแมวพูดจบทั้งเทิร์น เคลียร์ offTopic ทั้งที่ยังพูดต่ออีก 90ms ถัดมาจริง ๆ (หน้าโกรธ
// แว้บหาย) ตั้งค่าไว้เผื่อเยอะกว่าช่องว่างจริงที่เจอมาก (7-90ms) เพราะไม่กระทบความไวของบทสนทนา
// (ผู้ใช้ไม่เห็นหน้า listening/thinking ช้าลง — คุมแค่ตอนแมวพูดจบแล้วเท่านั้น)
const BOT_SPEECH_END_HANGOVER_MS = 700;
const IDLE_TO_SLEEP_MS = 15000; // เงียบนานเท่าไหร่ถึงเข้าสถานะ Sleep (mirror แนวคิด VAD_SILENCE_TIMEOUT_S)

// ⚠️ ทดลองแก้บั๊ก "เสียงติ๊ก/ป็อบแทรกระหว่างแมวพูด" (2026-09-08) — ยังไม่ยืนยันด้วยอุปกรณ์จริง/หูจริง
// ห้ามเชื่อว่าหายแล้วจนกว่าจะรัน docs/click-noise-manual-test-plan.md บนแท็บเล็ตจริง (ดู CLAUDE.md)
//
// รอบแรก (ก่อนหน้านี้ในวันเดียวกัน) เคยใส่ margin แค่ตอน flush ก้อนแรกของเทิร์นเท่านั้น เพราะเดาว่า
// สาเหตุคือลูป synchronous ตอนเทิร์นเริ่ม — **ผิด** ใส่ diagnostic logging จริงแล้วเก็บหลักฐานจาก
// ผู้ใช้ทดสอบบน Mac ด้วย diagnostic logging (2026-09-08 บ่าย): **gap ทั้งหมด 11 ครั้งที่เจอ
// เป็น `origin=stream` ล้วนๆ ไม่มี `origin=flush` แม้แต่ครั้งเดียว** — แปลว่า mechanism จริงคือตอน
// schedule ทีละก้อนที่มาจาก WS ระหว่างเทิร์น (chunk มาช้ากว่าจังหวะเล่นจริง) ไม่ใช่ลูป flush ตอนเริ่ม
// เทิร์นตามที่ CLAUDE.md เดาไว้แต่แรก — ขนาด gap เล็กที่เจอจริง (ตัดกลุ่มใหญ่ที่เป็นความเงียบระหว่าง
// เทิร์นทิ้ง เพราะไม่มีใครได้ยิน): 5.8ms, 40.6ms, 69.6ms, 75.4ms
//
// จึงย้าย margin มาใช้ใน computeChunkSchedule ตรงๆ (ใส่ทุกครั้งที่เกิด hadGap ไม่ว่า origin ไหน)
// แทนที่จะใส่แค่จุดเดียวตอน flush — ครอบคลุมทั้ง 2 เส้นทางจริง ไม่ต้อง diagnose ซ้ำว่า origin ไหน
// สำคัญกว่ากัน (ข้อมูลจริงบอกแล้วว่า stream สำคัญกว่ามาก)
//
// ⚠️ trade-off ที่ต้องรู้ (ยืนยันด้วยแบบจำลองแล้ว ไม่ใช่แค่เดา — ดู useVoiceSocket.test.ts): ใส่ margin
// ทุกครั้งที่ hadGap ไม่ได้ลดขนาด gap ครั้งนั้นๆ ที่กำลังเกิด (จริงๆ ทำให้ครั้งนั้น "ใหญ่ขึ้น" อีก
// margin หนึ่ง) แต่จะเพิ่ม lead time ให้ก้อนถัดๆไปมีโอกาสไม่ gap ซ้ำในช่วงสั้นๆ ถัดมา — เป็นการแลก
// "ความถี่" กับ "ขนาดครั้งที่เกิด" ไม่รู้ว่าหูมนุษย์จะรู้สึกดีขึ้นหรือแย่ลงจนกว่าจะฟังจริง เสี่ยงซ้ำรอย
// บั๊กเดิมที่เคยลอง fade แล้วแย่ลงกว่าเดิม (commit 48b4860/32f646c ที่ CLAUDE.md สั่งห้ามลองซ้ำ — อันนี้
// คนละกลไกกับ fade ไม่ได้แตะการ fade เข้า-ออกเลย)
//
// เผื่อไม่ช่วย/แย่ลง: ตั้งค่านี้เป็น 0 เพื่อ revert กลับพฤติกรรมเดิมได้ทันที (จุดเดียวจบ)
const CHUNK_RECOVERY_MARGIN_MS = 10;
const CHUNK_RECOVERY_MARGIN_SEC = CHUNK_RECOVERY_MARGIN_MS / 1000;

// backend รันคนละ origin กับหน้านี้ (5174 vs 8000) ต่อ WS ตรง ๆ ได้เลย ไม่ติด CORS (WS ไม่ผ่าน
// browser CORS preflight เหมือน HTTP ปกติ — ยืนยันจาก source ของ Starlette CORSMiddleware ตรง ๆ
// (`if scope["type"] != "http": ปล่อยผ่านเลย`) และ routers/voice.py ก็ไม่เช็ค origin เองอยู่แล้ว)
//
// ห้าม hardcode "localhost" ตรงนี้ — ใช้ไม่ได้เลยตอนเปิดจากแท็บเล็ตจริงผ่าน LAN เพราะ "localhost"
// จากมุมมองแท็บเล็ตหมายถึงตัวแท็บเล็ตเอง ไม่ใช่เครื่อง backend เดา default จาก hostname ของหน้านี้แทน
// (ครอบคลุมเคสที่พบบ่อยสุด: เครื่องเดียวรัน backend+frontend ทั้งคู่ แท็บเล็ตเข้าผ่าน IP เดียวกัน)
// ถ้า backend อยู่คนละเครื่องจริง ๆ ให้ตั้ง VITE_VOICE_WS_URL ตอน build/dev แทน (ดู README)
const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const WS_URL = import.meta.env.VITE_VOICE_WS_URL ?? `${wsProtocol}://${location.hostname}:8000/api/voice/ws`;

export type VoiceConnectionState = "idle" | "connecting" | "connected" | "error" | "closed";

interface UseVoiceSocketResult {
  connectionState: VoiceConnectionState;
  catState: CatState;
  /**
   * true ตอนแมวกำลังพูดจริง (ต่างจาก catState==="wake" ที่ตั้งทั้งตอนผู้ใช้พูดและตอนแมวพูด — ค่านี้
   * แยกให้ชัดเจน เพิ่มมาให้ CatFace ใหม่ (จาก Figma) เลือกได้ว่าจะโชว์ "listening" หรือ "speaking"
   * ตอน catState เป็น wake เหมือนกัน ดู docs/adr และ CLAUDE.md เรื่องแมป 7→5 states)
   */
  botSpeaking: boolean;
  /**
   * true ตอนผู้ใช้หยุดพูดแล้วแต่แมวยังไม่เริ่มตอบ (รอ retrieval/LLM) — ช่วงเงียบที่สุดของบทสนทนา
   * ผู้ใช้ต้องเห็นว่าระบบยังทำงานอยู่ ไม่งั้นจะพูดซ้ำเพราะนึกว่าไม่ได้ยิน ใช้แยก "thinking" ออกจาก
   * "listening" ตอน catState เป็น wake เหมือนกัน (เดิมค่านี้เคยเป็น catState แยกชื่อ "web" แต่ตัด
   * ออกจาก CatState แล้วเพราะ "Web" ใน TOR หมายถึงโหมดข่าววนคนละเรื่อง — ดู CLAUDE.md)
   */
  isThinking: boolean;
  /**
   * true ตอน backend ส่ง {"type":"off_topic"} มา (Gemini เรียก tool flag_off_topic เอง ตอนจะ
   * ปฏิเสธคำถามนอกขอบเขต — ดูคอมเมนต์ที่ ws.onmessage) หมดอายุเองตอนแมวพูดตอบจบแล้วกลับ idle
   * ไม่ค้างโกรธข้ามเทิร์นถัดไป
   */
  offTopic: boolean;
  amplitude: number;
  transcript: string;
  errorMessage: string | null;
  /** `greetFirst`: ให้แมวทักทายก่อนเองโดยไม่ต้องรอผู้ใช้พูด — ใช้เฉพาะตอนตื่นจาก wake-word เท่านั้น
   * (ปุ่ม "เริ่มคุย" ไม่ส่ง flag นี้ ยังคงพฤติกรรมเดิมทุกประการ) */
  connect: (options?: { greetFirst?: boolean }) => Promise<void>;
  disconnect: () => void;
  /**
   * ค่าดิบของ local RMS VAD ต่อเฟรม — มีค่าจริงเฉพาะตอนเปิด `{ debug: true }` เท่านั้น (ปิดไว้เป็น
   * ปกติกันการ re-render ถี่เกินจำเป็นตอนใช้งานจริง) สำหรับ debug overlay (`?debug=1`) ดูค่า RMS
   * เทียบ threshold สดตอนพูดจริง ก่อนตัดสินใจปรับ LOCAL_VAD_RMS_THRESHOLD/hangover ร่วมกัน
   */
  debugVad: { rms: number; isSpeechNow: boolean; wasSpeech: boolean } | null;
}

export function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export function pcm16ToFloat32(buf: ArrayBuffer): Float32Array<ArrayBuffer> {
  const int16 = new Int16Array(buf);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

export function rmsOf(float32: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
}

/**
 * ตัดสินใจ "ก้อนเสียงถัดไปควรเริ่มเล่นตอนไหน" ล้วน ๆ — แยกออกมาจาก scheduleChunk เดิมเพื่อเทสได้โดย
 * ไม่ต้องพึ่ง AudioContext จริง ตรรกะเดิมเป๊ะ ไม่เปลี่ยนพฤติกรรม (ดู scheduleChunk ที่เรียกฟังก์ชันนี้)
 *
 * hadGap=true คือกรณีต้องสงสัยของบั๊กเสียงติ๊ก/ป็อบ (ดู CLAUDE.md หัวข้อ "เสียงติ๊ก/ป็อบแทรกระหว่าง
 * แมวพูด"): ก้อนถัดไปถูกวางแผนไว้ให้เริ่มที่ prevNextPlayTime (ต่อจากก้อนก่อนแบบไม่มีช่องว่าง) แต่
 * ตอนถึงเวลาจะ schedule จริง เวลาปัจจุบัน (now) ไหลเลย prevNextPlayTime ไปแล้ว ต้องเลื่อนไปเริ่มที่
 * now แทน เกิดช่องว่างเงียบสั้น ๆ ระหว่างก้อนที่ตั้งใจให้ต่อกันสนิท — **ยืนยันด้วยหลักฐานจริงแล้ว
 * (2026-09-08, diagnostic logging) ว่าเกิดจากเส้นทาง "stream" (schedule ทีละก้อนตอนรับผ่าน WS
 * ระหว่างเทิร์น) เป็นหลัก ไม่ใช่ "flush" (ลูปตอนเทิร์นเริ่ม) ตามที่เคยเดาไว้แต่แรก** ดูรายละเอียดที่
 * CHUNK_RECOVERY_MARGIN_MS ด้านบนไฟล์
 *
 * recoveryMarginSec: ใส่ margin เฉพาะตอนเกิด hadGap เท่านั้น (ไม่กระทบเคสต่อกันสนิทปกติเลย) — ไม่ลด
 * ขนาด gap ที่กำลังเกิดครั้งนี้ (จริงๆ ทำให้ครั้งนี้ใหญ่ขึ้นอีก margin หนึ่ง) แต่ให้ lead time ก้อนถัดไป
 * มีโอกาสไม่ gap ซ้ำในช่วงสั้นๆ ถัดมา (แลกความถี่กับขนาด — ดูเทส "recovery margin" ประกอบ) default 0
 * = พฤติกรรมเดิมเป๊ะ
 */
export function computeChunkSchedule(
  prevNextPlayTime: number,
  now: number,
  duration: number,
  recoveryMarginSec: number = 0,
): { startTime: number; nextPlayTime: number; hadGap: boolean } {
  const hadGap = prevNextPlayTime < now;
  const startTime = hadGap ? now + recoveryMarginSec : prevNextPlayTime;
  return { startTime, nextPlayTime: startTime + duration, hadGap };
}

export type ScheduledAudio = { startTime: number; endTime: number };

/** True only while an actual PCM chunk is playing, not during queued silence. */
export function isScheduledAudioPlaying(scheduled: ScheduledAudio[], now: number): boolean {
  return scheduled.some(({ startTime, endTime }) => startTime <= now && now < endTime);
}

/**
 * ต่อไมค์จริงในเบราว์เซอร์ <-> WS (/api/voice/ws) <-> Gemini Live <-> เล่นเสียงตอบจริง
 * โปรโตคอลเดียวกับ backend/app/static/voice_test.html (พิสูจน์แล้วว่าใช้งานได้จริง) — พอร์ตมาเป็น
 * React hook แล้วเพิ่ม 2 อย่างที่ voice_test.html ไม่มี:
 *   1. Half-duplex (ปิดไมค์ตอนแมวพูด) — เหตุผลเดียวกับที่ตัดสินใจไว้ใน voice_pipeline_dev.py:
 *      เครื่อง dev ไม่มี AEC ฮาร์ดแวร์ เสียงลำโพงจะหลุดเข้าไมค์แล้วสับสนกับเสียงพูดจริงได้
 *   2. amplitude สำหรับขับ lip-flap — วัดจาก "เสียงที่กำลังเล่นออกจริง" ผ่าน AnalyserNode ที่ต่อ
 *      อยู่ในเส้นทางเล่นเสียงจริง ไม่ใช่วัดตอนเพิ่งรับข้อมูลมาจาก WS (ซึ่งจะเพี้ยนไปหน้า jitter
 *      buffer ~1.5s ทำให้ปากขยับก่อนเสียงจริงจะดังก็ได้)
 */
export function useVoiceSocket(opts: { debug?: boolean } = {}): UseVoiceSocketResult {
  const debugEnabled = opts.debug ?? false;
  const [connectionState, setConnectionState] = useState<VoiceConnectionState>("idle");
  // A public kiosk waits in the sleeping state until the visitor invokes it.
  const [catState, setCatState] = useState<CatState>("sleep");
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [debugVad, setDebugVad] = useState<UseVoiceSocketResult["debugVad"]>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [offTopic, setOffTopic] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  // `nextPlayTimeRef` includes recovery margin for queueing. Keep actual PCM
  // intervals separately so that margin silence does not mute the microphone.
  const scheduledAudioRef = useRef<ScheduledAudio[]>([]);
  const playbackBufferedMsRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catStateRef = useRef<CatState>("sleep"); // อ่านค่าล่าสุดใน callback ที่ไม่ได้ re-render ผูกด้วย
  const wasSpeechRef = useRef(false); // เดิม/จบพูดรอบล่าสุด — ใช้ส่ง speech_start/speech_end ให้ backend
  const silentStreakRef = useRef(0); // นับ buffer เงียบติดกัน ใช้ทำ hangover ก่อนส่ง speech_end จริง
  const listeningSilentStreakRef = useRef(0); // นับ buffer เงียบติดกัน ใช้ทำ hangover ก่อนสลับ UI เป็น thinking (แยกจาก silentStreakRef ข้างบน — คนละ hangover คนละจุดประสงค์ ดู LISTENING_HANGOVER_MS)
  // true ตั้งแต่แมวเริ่มพูดจริงในเทิร์นนี้ (isBotSpeaking() ขึ้น true ครั้งแรก) — เพิ่งเจอบั๊กจริงว่า
  // tick() (รันทุก requestAnimationFrame ~60fps เร็วกว่า onaudioprocess ~85ms มาก) มี `else if
  // (catStateRef.current === "wake")` ที่เดิมตั้งใจจับแค่ "แมวพูดจบแล้ว" แต่ดันเป็น true ด้วยตอน
  // "ผู้ใช้เพิ่งพูดจบ ยังไม่ทันถึงคิวแมวตอบ" เหมือนกัน (isBotSpeaking() เป็น false ทั้งคู่) เลย
  // reset เป็น idle ภายใน 400ms หลังผู้ใช้เงียบ ทั้งที่ Gemini ยังไม่ทันตอบเลย (ต้องรอ tool call +
  // JITTER_BUFFER_MS 1.5s ก่อน isBotSpeaking() จะ true จริง) ผลคือ isThinking/offTopic ถูกเคลียร์
  // ทิ้งไปก่อนจะมีโอกาสได้แสดงผลเลยด้วยซ้ำ — ต้องรู้ก่อนว่าแมว "เคยพูดจริงในเทิร์นนี้แล้ว" ถึงจะยอม
  // reset กลับ idle ได้
  const hasBotSpokenThisTurnRef = useRef(false);
  // performance.now() ตอนแรกที่ tick() เห็น !isBotSpeaking() ระหว่างเทิร์นที่แมวเคยพูดแล้ว (สำหรับนับ
  // hangover ก่อนยอมรับว่าจบเทิร์นจริง — ดู BOT_SPEECH_END_HANGOVER_MS) null = ยังไม่เห็นช่องว่างเลย
  // หรือแมวกลับมาพูดต่อแล้วก่อนครบ hangover (reset กลับ null ทุกครั้งที่ speaking กลับมา true)
  const botSpeechEndSinceRef = useRef<number | null>(null);

  const setCatStateSafe = useCallback((s: CatState) => {
    catStateRef.current = s;
    setCatState(s);
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (catStateRef.current !== "sleep") setCatStateSafe("sleep");
    }, IDLE_TO_SLEEP_MS);
  }, [setCatStateSafe]);

  /** แมวกำลังพูด/มีเสียงค้างเล่นอยู่ไหม (ใช้ตัดสินใจ half-duplex + สลับ state) */
  const isBotSpeaking = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return false;
    const now = ctx.currentTime;
    scheduledAudioRef.current = scheduledAudioRef.current.filter(({ endTime }) => endTime > now);
    return isScheduledAudioPlaying(scheduledAudioRef.current, now);
  }, []);

  const disconnect = useCallback(() => {
    // เช็คก่อนว่าเคย connect จริงไหม — กัน React StrictMode (dev mode double-invoke effect)
    // เรียก disconnect() ตอน mount ครั้งแรกทั้งที่ยังไม่เคยกด "เริ่มคุย" เลย ทำให้สถานะโชว์ผิดเป็น
    // "ปิดการเชื่อมต่อแล้ว" ทั้งที่ควรเป็น "ยังไม่เริ่ม"
    if (!audioCtxRef.current && !wsRef.current) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    micProcessorRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setConnectionState("closed");
    setCatStateSafe("sleep");
    setAmplitude(0);
    setBotSpeaking(false);
    setIsThinking(false);
    setOffTopic(false);
    setDebugVad(null);
  }, [setCatStateSafe]);

  const connect = useCallback(async (options?: { greetFirst?: boolean }) => {
    setErrorMessage(null);
    setConnectionState("connecting");
    setTranscript("");
    wasSpeechRef.current = false; // กัน state ค้างข้ามรอบ connect (เช่น reconnect หลังกด หยุด/เริ่มใหม่)
    silentStreakRef.current = 0;
    listeningSilentStreakRef.current = 0;
    hasBotSpokenThisTurnRef.current = false;
    botSpeechEndSinceRef.current = null;
    setOffTopic(false);

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    // มือถือ (Android Chrome รวมถึง Safari) เข้มงวดเรื่อง autoplay กว่า desktop บางรุ่น AudioContext
    // ที่สร้างใหม่อาจเริ่มที่ state "suspended" แม้จะสร้างระหว่าง user gesture (คลิกปุ่ม "เริ่มคุย")
    // ก็ตาม — resume() ตรงนี้ (ยังอยู่ในเส้นทางเดียวกับ gesture handler) ชัวร์กว่าปล่อยเดา
    void audioCtx.resume();
    nextPlayTimeRef.current = 0;
    scheduledAudioRef.current = [];
    playbackBufferedMsRef.current = 0;
    playbackStartedRef.current = false;

    // เส้นทางเล่นเสียงตอบ: sourceตัวๆ -> outputGain (รวมทุกชิ้นที่ schedule ไว้) -> analyser -> ลำโพง
    // amplitude วัดจาก analyser ตัวนี้ ตรงกับเสียงที่ "กำลังออกลำโพงจริง" เสมอไม่ว่าจะบัฟไว้นานแค่ไหน
    const outputGain = audioCtx.createGain();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    outputGain.connect(analyser);
    analyser.connect(audioCtx.destination);
    analyserRef.current = analyser;

    const scheduleChunk = (arrayBuffer: ArrayBuffer) => {
      const float32 = pcm16ToFloat32(arrayBuffer);
      const buffer = audioCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(float32, 0);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(outputGain);
      const { startTime, nextPlayTime } = computeChunkSchedule(
        nextPlayTimeRef.current,
        audioCtx.currentTime,
        buffer.duration,
        CHUNK_RECOVERY_MARGIN_SEC,
      );
      source.start(startTime);
      nextPlayTimeRef.current = nextPlayTime;
      scheduledAudioRef.current.push({ startTime, endTime: startTime + buffer.duration });
    };

    const pendingQueue: ArrayBuffer[] = [];
    const enqueueAudio = (arrayBuffer: ArrayBuffer) => {
      if (!playbackStartedRef.current) {
        pendingQueue.push(arrayBuffer);
        playbackBufferedMsRef.current += (arrayBuffer.byteLength / 2 / OUTPUT_SAMPLE_RATE) * 1000;
        if (playbackBufferedMsRef.current >= JITTER_BUFFER_MS) {
          playbackStartedRef.current = true;
          // margin ย้ายไปอยู่ใน computeChunkSchedule แล้ว (ดูคอมเมนต์ CHUNK_RECOVERY_MARGIN_MS
          // ด้านบนไฟล์ — หลักฐานจริงยืนยันว่า origin=flush นี้แทบไม่เกิด hadGap เลย ตัวที่เกิดจริง
          // คือ origin=stream) ตรงนี้จึงไม่ต้องมี margin ซ้ำซ้อนสองที่
          nextPlayTimeRef.current = audioCtx.currentTime;
          for (const chunk of pendingQueue) scheduleChunk(chunk);
          pendingQueue.length = 0;
        }
      } else {
        scheduleChunk(arrayBuffer);
      }
    };

    // วน rAF อ่าน amplitude จาก analyser ต่อเนื่อง + คุม cat state ตามว่าแมวพูดอยู่ไหม
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let smoothed = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i++) {
        const n = (buf[i] - 128) / 128;
        sumSquares += n * n;
      }
      const rms = Math.sqrt(sumSquares / buf.length);
      const target = Math.min(1, rms * 3.5);
      smoothed += (target - smoothed) * 0.35;
      setAmplitude(smoothed);

      const speaking = isBotSpeaking();
      setBotSpeaking(speaking);
      if (speaking) {
        if (catStateRef.current !== "wake") setCatStateSafe("wake");
        setIsThinking(false); // แมวเริ่มพูดจริงแล้ว เลิกนับว่าเป็นช่วงรอคำตอบ
        hasBotSpokenThisTurnRef.current = true; // ยืนยันแล้วว่าเทิร์นนี้แมวได้พูดจริง ไม่ใช่แค่เงียบเฉย ๆ
        botSpeechEndSinceRef.current = null; // ยังพูดต่ออยู่จริง (หรือกลับมาพูดต่อทันภายใน hangover) ยกเลิกนับถอยหลังจบเทิร์น
        resetIdleTimer();
      } else if (catStateRef.current === "wake" && hasBotSpokenThisTurnRef.current) {
        // ต้องเช็ค hasBotSpokenThisTurnRef ด้วย ไม่ใช่แค่ !speaking — ไม่งั้น branch นี้ทำงานทันทีตอน
        // ผู้ใช้เพิ่งพูดจบเหมือนกัน (isBotSpeaking() เป็น false พอ ๆ กันทั้งสองกรณี) ทั้งที่ Gemini
        // ยังไม่ทันเริ่มตอบเลย (ดูคอมเมนต์ที่ hasBotSpokenThisTurnRef ด้านบน)
        //
        // เจอ race condition อีกชั้น (2026-09-08 log จริง): คิวเสียงระหว่างก้อน scheduleChunk มีช่องว่าง
        // จริงสั้น ๆ (7-90ms) ที่ isBotSpeaking() เป็น false ชั่วขณะทั้งที่ยังพูดต่ออีกก้อนถัดไปแน่ ๆ
        // ต้องรอ BOT_SPEECH_END_HANGOVER_MS ต่อเนื่องก่อนยอมรับว่าจบเทิร์นจริง ไม่ใช่ทำทันทีเฟรมแรกที่
        // เห็น !speaking (เหมือนที่ทำกับ listening -> thinking ด้วย listeningSilentStreakRef)
        if (botSpeechEndSinceRef.current === null) {
          botSpeechEndSinceRef.current = performance.now();
        } else if (performance.now() - botSpeechEndSinceRef.current >= BOT_SPEECH_END_HANGOVER_MS) {
          setCatStateSafe("transition");
          setOffTopic(false); // จบเทิร์นแล้วจริง ๆ (แมวพูดจบแล้ว) กันไม่ให้ค้างโกรธข้ามไปเทิร์นถัดไป
          botSpeechEndSinceRef.current = null;
          setTimeout(() => {
            if (catStateRef.current === "transition") setCatStateSafe("idle");
          }, 400);
        }
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);

    // ---- ไมค์: จับเสียง -> downsample เป็น 16kHz -> ส่งเข้า WS (half-duplex: เว้นตอนแมวพูด) ----
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: INPUT_SAMPLE_RATE },
    });
    micStreamRef.current = micStream;
    const micSource = audioCtx.createMediaStreamSource(micStream);
    micSourceRef.current = micSource;
    const micProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
    micProcessorRef.current = micProcessor;
    micSource.connect(micProcessor);
    micProcessor.connect(audioCtx.destination); // ไม่มีเสียงออกจริง (ไม่ได้เขียน outputBuffer) แค่ให้ node ทำงาน

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // hangover เป็นจำนวน buffer แทนหน่วยเวลาตรง ๆ เพราะ ScriptProcessor เรียก callback ตาม
    // audioCtx.sampleRate ของเครื่อง (48kHz เดสก์ท็อปทั่วไป แต่ไม่การันตี) ไม่ใช่ INPUT_SAMPLE_RATE
    const BUFFER_SIZE = 4096;
    const hangoverBuffers = Math.max(1, Math.round((SILENCE_HANGOVER_MS / 1000) * audioCtx.sampleRate / BUFFER_SIZE));
    const listeningHangoverBuffers = Math.max(1, Math.round((LISTENING_HANGOVER_MS / 1000) * audioCtx.sampleRate / BUFFER_SIZE));

    micProcessor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);

      // Half-duplex โดยตั้งใจ (ดูคอมเมนต์บนสุดของไฟล์) — เว้นการส่งไมค์ตอนแมวกำลังพูด
      if (isBotSpeaking()) {
        // ถ้าเพิ่งพูดค้างอยู่ตอนโดน mute (เช่น เผลอพูดคาบเกี่ยวจังหวะที่เสียงแมวเริ่มเล่นจริงหลัง
        // jitter buffer 1.5s ซึ่ง isBotSpeaking() ยังไม่ทันขึ้น true) ต้องปิด activity ให้ Gemini
        // ทันทีตรงนี้ ไม่งั้น wasSpeechRef ค้างเป็น true ข้ามรอบ mute พอเปิดไมค์กลับมาแล้วผู้ใช้เริ่ม
        // ถามคำถามถัดไปจริง ๆ เงื่อนไข isSpeech && !wasSpeechRef.current จะเป็น false ตลอด (เพราะ
        // wasSpeechRef ค้างมาจากรอบก่อน) เลยไม่ส่ง speech_start ให้ Gemini อีกเลย — กลายเป็นบั๊กเดิม
        // "คุยได้แค่รอบเดียว" กลับมาผ่านทางอ้อม ทั้งที่แก้ AAD ไปแล้ว
        if (wasSpeechRef.current) {
          ws.send(JSON.stringify({ type: "speech_end" }));
          wasSpeechRef.current = false;
        }
        silentStreakRef.current = 0;
        return;
      }

      const ratio = audioCtx.sampleRate / INPUT_SAMPLE_RATE;
      const outLength = Math.floor(input.length / ratio);
      const resampled = new Float32Array(outLength);
      for (let i = 0; i < outLength; i++) resampled[i] = input[Math.floor(i * ratio)];

      // local RMS ตัวนี้ "มีผลจริง" กับ backend — backend ปิด automatic_activity_detection ของ
      // Gemini แล้ว (ดูคอมเมนต์ใน routers/voice.py: AAD ของโมเดลนี้ตรวจจับ "เริ่มพูด" ได้แค่ครั้งแรก
      // ของ session เท่านั้น ไม่ re-arm ให้จับรอบสองอัตโนมัติ) ต้องส่ง speech_start/speech_end เอง
      // ทุกครั้งที่ผ่าน transition เงียบ<->พูด ไม่งั้น Gemini จะไม่รู้เลยว่ามีคำถามใหม่มา
      //
      // ใช้ hangover (เงียบต่อเนื่อง hangoverBuffers ครั้งถึงจะถือว่าจบจริง) กัน buffer เงียบสั้น ๆ
      // แค่ 1 ครั้ง (~85ms ที่ 48kHz เว้นวรรค/หายใจกลางประโยค) ตัด activity_end กลางคำถามที่ยังพูดไม่จบ
      const localRms = rmsOf(resampled);
      const isSpeechNow = localRms > LOCAL_VAD_RMS_THRESHOLD;
      // อัปเดตเฉพาะตอนเปิด debug (opts.debug) เท่านั้น — กัน re-render ทุก ~85ms (ความถี่ของ
      // onaudioprocess ที่ buffer 4096 @48kHz) ตอนใช้งานจริงที่ไม่ได้ต้องการเลย
      if (debugEnabled) {
        setDebugVad({ rms: localRms, isSpeechNow, wasSpeech: wasSpeechRef.current });
      }
      if (isSpeechNow) {
        silentStreakRef.current = 0;
        if (!wasSpeechRef.current) {
          ws.send(JSON.stringify({ type: "speech_start" }));
          wasSpeechRef.current = true;
        }
      } else if (wasSpeechRef.current) {
        silentStreakRef.current += 1;
        if (silentStreakRef.current >= hangoverBuffers) {
          ws.send(JSON.stringify({ type: "speech_end" }));
          wasSpeechRef.current = false;
          silentStreakRef.current = 0;
        }
      }

      // ส่งเสียงเข้า Gemini แค่ช่วงที่ยังถือว่า "อยู่ในประโยคเดียวกัน" (รวมช่วง hangover ที่ยังไม่ทัน
      // ยืนยันว่าจบจริง) เท่านั้น — เงียบที่ผ่าน hangover ไปแล้วไม่ต้องส่งต่อ ประหยัด bandwidth/quota
      // โดยไม่กระทบผล เพราะ Gemini (AAD ปิดแล้ว) สนใจแค่เสียงระหว่าง activity_start/end เท่านั้น
      if (wasSpeechRef.current) {
        ws.send(floatTo16BitPCM(resampled));
      }

      // ส่วนนี้แค่ขยับ cat state ให้ตอบสนองไว (UI ล้วน ๆ แยกจาก speech_start/end ด้านบน)
      if (isSpeechNow) {
        if (catStateRef.current === "idle" || catStateRef.current === "sleep") {
          setCatStateSafe("wake");
          hasBotSpokenThisTurnRef.current = false; // เทิร์นใหม่ แมวยังไม่ได้พูดเลยสักคำ
        }
        listeningSilentStreakRef.current = 0; // ยังพูดต่อเนื่อง (หรือกลับมาพูดทันเวลาภายใน hangover) ไม่นับว่าเงียบ
        setIsThinking(false); // เริ่มพูดรอบใหม่ ไม่ใช่ช่วงรอคำตอบเดิมแล้ว
        resetIdleTimer();
      } else if (catStateRef.current === "wake" && !isBotSpeaking()) {
        // ผู้ใช้หยุดพูดแล้วแต่แมวยังไม่เริ่มตอบ (รอ retrieval/LLM) — เดิม catState เคยตั้งเป็น "web"
        // ตรงนี้ แต่ตัด "web" ออกจาก CatState แล้ว (ดู types.ts, CLAUDE.md) เปลี่ยนมาใช้ isThinking
        // แทน — ให้ CatFace โชว์ "thinking" (หูหยุดสลับ+กระพริบถี่ขึ้น) แยกจาก "listening" ชัดเจน
        // เพราะช่วงนี้เงียบที่สุดในบทสนทนา ผู้ใช้ต้องเห็นว่าระบบยังทำงานอยู่ ไม่งั้นจะพูดซ้ำ
        //
        // ต้องรอ listeningHangoverBuffers ก่อนค่อยยอมสลับ (ไม่ใช่ทันทีที่ isSpeechNow เป็น false
        // buffer เดียว) — พบจริงจากทดสอบเสียงจริง 2026-09-08 ว่าเว้นหายใจสั้น ๆ ระหว่างประโยค
        // (0.1-0.2s) ทำให้ตากรอก/หูพับรีเซ็ตใหม่ทุกครั้งเหมือนเริ่มประโยคใหม่ ทั้งที่ยังพูดอยู่
        listeningSilentStreakRef.current += 1;
        if (listeningSilentStreakRef.current >= listeningHangoverBuffers) {
          setIsThinking(true);
        }
      }
    };

    ws.onopen = () => {
      setConnectionState("connected");
      setCatStateSafe("sleep");
      resetIdleTimer();
      // เฉพาะทาง wake-word (App.tsx: useWakeWord's onDetected) — ผู้ใช้เพิ่งเรียกด้วยเสียงแล้วไม่มี
      // ปุ่มให้กดยืนยันอีกที ต่างจากปุ่ม "เริ่มคุย" ที่ผู้ใช้ตั้งใจกดเพื่อเริ่มพูดเองอยู่แล้ว จึงยังคง
      // รอผู้ใช้พูดก่อนตามปกติ (ไม่ทักทายเอง) — ดู docs/superpowers/specs/2026-09-08-wake-word-design.md
      if (options?.greetFirst) {
        ws.send(JSON.stringify({ type: "greet_first" }));
      }
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data) as { type: string; text?: string };
        if (msg.type === "transcript" && msg.text) {
          setTranscript((prev) => prev + msg.text);
        } else if (msg.type === "turn_complete") {
          // เสียงอาจยังเล่นค้างอยู่ (บัฟไว้ล่วงหน้า) — ปล่อยให้ isBotSpeaking() ใน tick() เป็นคนตัดสิน
          // ว่าจบจริงเมื่อไหร่ ไม่ reset transcript ที่นี่ทันที เผื่อผู้ใช้อยากอ่านคำตอบล่าสุด
        } else if (msg.type === "off_topic") {
          // flag เชิงโครงสร้างจาก backend (Gemini เรียก tool flag_off_topic เอง — ไม่ได้เดาจาก
          // keyword ใน transcript ห้าม guess เด็ดขาดตามที่ตกลงกันไว้) มาถึงก่อนเสียงตอบจะเริ่มเล่น
          // เสมอ (ระหว่างรอ tool_call resolve) ต้องหมดอายุเองหลังบอทพูดจบ — reset ที่จุดเดียวกับที่
          // "wake" -> "transition" -> "idle" ทำงานใน tick() ด้านล่าง ไม่ใช่ค้างโกรธข้ามเทิร์นถัดไป
          setOffTopic(true);
        }
      } else if (event.data instanceof ArrayBuffer) {
        enqueueAudio(event.data);
      }
    };
    ws.onerror = () => {
      setErrorMessage("เชื่อมต่อ WebSocket ไม่สำเร็จ — เช็คว่า backend รันอยู่ที่ localhost:8000 หรือเปล่า");
      setConnectionState("error");
    };
    ws.onclose = (closeEvent) => {
      // backend ปิด WS เองพร้อม code+reason ในบางเคส (เช่น ไม่มี GEMINI_API_KEY ใน .env —
      // ดู routers/voice.py `websocket.close(code=1011, reason=...)`) เดิมโค้ดทิ้ง event ไปเฉยๆ
      // ผู้ใช้กดเริ่มคุยแล้วเห็นแค่กลับไป idle เงียบๆ ไม่รู้เลยว่าทำไม (2026-09-08 เจอเคสจริง) —
      // โชว์ reason ให้เห็นถ้ามี แทนที่จะเงียบเหมือนไม่มีอะไรเกิดขึ้น (code 1000 = ปิดปกติ ไม่ต้องโชว์)
      if (closeEvent.code !== 1000 && closeEvent.reason) {
        setErrorMessage(`การเชื่อมต่อถูกปิด (${closeEvent.code}): ${closeEvent.reason}`);
      }
      setConnectionState((prev) => (prev === "error" ? prev : "closed"));
      // เจอจริงตอนทดสอบ: ถ้า WS หลุดกะทันหัน (ไม่ใช่กดปุ่ม "หยุดคุย" — นั่นไปทาง disconnect()
      // ที่ reset ครบอยู่แล้ว) ตอนแมวกำลังโกรธ/ฟัง/คิดอยู่พอดี ค่าพวกนี้จะไม่มีใคร reset เลย ค้างข้าม
      // ไปยัง session/การเชื่อมต่อครั้งถัดไป (คนถัดไปกดเริ่มคุยมาเจอแมวโกรธใส่ทันที แย่กว่าบั๊กเดิม)
      // เคลียร์กลับ idle ให้ครบเหมือนตอน disconnect() ปกติ — ต้อง clear idleTimerRef ด้วย ไม่งั้น
      // ถ้ามี timer ค้างจากก่อนหน้า (ตั้งไว้จาก resetIdleTimer() รอบล่าสุดตอนยังเชื่อมต่ออยู่) มันจะ
      // ยิง setCatStateSafe("sleep") ทับ idle ที่เพิ่ง set ไปหลังจากนี้อีกที (เจอจริงตอนทดสอบ)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setCatStateSafe("sleep");
      setBotSpeaking(false);
      setIsThinking(false);
      setOffTopic(false);
      setAmplitude(0);
      hasBotSpokenThisTurnRef.current = false;
      botSpeechEndSinceRef.current = null;
      wasSpeechRef.current = false;
      silentStreakRef.current = 0;
      listeningSilentStreakRef.current = 0;
    };
  }, [isBotSpeaking, resetIdleTimer, setCatStateSafe, debugEnabled]);

  useEffect(() => disconnect, [disconnect]); // cleanup ตอน unmount

  return { connectionState, catState, botSpeaking, isThinking, offTopic, amplitude, transcript, errorMessage, connect, disconnect, debugVad };
}
