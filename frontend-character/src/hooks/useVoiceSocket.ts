import { useCallback, useEffect, useRef, useState } from "react";
import type { CatState } from "../types";

const INPUT_SAMPLE_RATE = 16000; // Gemini Live รับเสียงเข้าที่ 16kHz PCM16 mono
const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live ส่งเสียงตอบกลับมาที่ 24kHz PCM16 mono
const JITTER_BUFFER_MS = 1500; // ตกลงกันไว้ตอนทำ backend (ดู voice_test.html/voice_pipeline_dev.py)
const LOCAL_VAD_RMS_THRESHOLD = 0.02; // ใช้ตัดสิน speech_start/speech_end ที่ส่งให้ backend จริง (ดู onaudioprocess)
const SILENCE_HANGOVER_MS = 500; // ต้องเงียบต่อเนื่องแค่ไหนถึงถือว่าพูดจบ กันตัดกลางคำที่มีช่วงเว้นวรรค/หายใจสั้น ๆ
const IDLE_TO_SLEEP_MS = 15000; // เงียบนานเท่าไหร่ถึงเข้าสถานะ Sleep (mirror แนวคิด VAD_SILENCE_TIMEOUT_S)

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
  amplitude: number;
  transcript: string;
  errorMessage: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function pcm16ToFloat32(buf: ArrayBuffer): Float32Array<ArrayBuffer> {
  const int16 = new Int16Array(buf);
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

function rmsOf(float32: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
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
export function useVoiceSocket(): UseVoiceSocketResult {
  const [connectionState, setConnectionState] = useState<VoiceConnectionState>("idle");
  const [catState, setCatState] = useState<CatState>("idle");
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
  const playbackBufferedMsRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catStateRef = useRef<CatState>("idle"); // อ่านค่าล่าสุดใน callback ที่ไม่ได้ re-render ผูกด้วย
  const wasSpeechRef = useRef(false); // เดิม/จบพูดรอบล่าสุด — ใช้ส่ง speech_start/speech_end ให้ backend
  const silentStreakRef = useRef(0); // นับ buffer เงียบติดกัน ใช้ทำ hangover ก่อนส่ง speech_end จริง

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
    return !!ctx && nextPlayTimeRef.current > ctx.currentTime;
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
    setCatStateSafe("idle");
    setAmplitude(0);
  }, [setCatStateSafe]);

  const connect = useCallback(async () => {
    setErrorMessage(null);
    setConnectionState("connecting");
    setTranscript("");
    wasSpeechRef.current = false; // กัน state ค้างข้ามรอบ connect (เช่น reconnect หลังกด หยุด/เริ่มใหม่)
    silentStreakRef.current = 0;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    // มือถือ (Android Chrome รวมถึง Safari) เข้มงวดเรื่อง autoplay กว่า desktop บางรุ่น AudioContext
    // ที่สร้างใหม่อาจเริ่มที่ state "suspended" แม้จะสร้างระหว่าง user gesture (คลิกปุ่ม "เริ่มคุย")
    // ก็ตาม — resume() ตรงนี้ (ยังอยู่ในเส้นทางเดียวกับ gesture handler) ชัวร์กว่าปล่อยเดา
    void audioCtx.resume();
    nextPlayTimeRef.current = 0;
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
      const now = audioCtx.currentTime;
      if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += buffer.duration;
    };

    const pendingQueue: ArrayBuffer[] = [];
    const enqueueAudio = (arrayBuffer: ArrayBuffer) => {
      if (!playbackStartedRef.current) {
        pendingQueue.push(arrayBuffer);
        playbackBufferedMsRef.current += (arrayBuffer.byteLength / 2 / OUTPUT_SAMPLE_RATE) * 1000;
        if (playbackBufferedMsRef.current >= JITTER_BUFFER_MS) {
          playbackStartedRef.current = true;
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

      if (isBotSpeaking()) {
        if (catStateRef.current !== "wake") setCatStateSafe("wake");
        resetIdleTimer();
      } else if (catStateRef.current === "wake") {
        // เพิ่งพูดจบ (เสียงเล่นหมดคิวแล้ว) — แฟลช transition สั้น ๆ แล้วกลับ idle
        setCatStateSafe("transition");
        setTimeout(() => {
          if (catStateRef.current === "transition") setCatStateSafe("idle");
        }, 400);
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
        if (catStateRef.current === "idle" || catStateRef.current === "sleep") setCatStateSafe("wake");
        resetIdleTimer();
      } else if (catStateRef.current === "wake" && !isBotSpeaking()) {
        setCatStateSafe("web"); // หยุดพูดแล้ว รอคำตอบ (retrieval/LLM กำลังทำงาน)
      }
    };

    ws.onopen = () => {
      setConnectionState("connected");
      setCatStateSafe("idle");
      resetIdleTimer();
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data) as { type: string; text?: string };
        if (msg.type === "transcript" && msg.text) {
          setTranscript((prev) => prev + msg.text);
        } else if (msg.type === "turn_complete") {
          // เสียงอาจยังเล่นค้างอยู่ (บัฟไว้ล่วงหน้า) — ปล่อยให้ isBotSpeaking() ใน tick() เป็นคนตัดสิน
          // ว่าจบจริงเมื่อไหร่ ไม่ reset transcript ที่นี่ทันที เผื่อผู้ใช้อยากอ่านคำตอบล่าสุด
        }
      } else if (event.data instanceof ArrayBuffer) {
        enqueueAudio(event.data);
      }
    };
    ws.onerror = () => {
      setErrorMessage("เชื่อมต่อ WebSocket ไม่สำเร็จ — เช็คว่า backend รันอยู่ที่ localhost:8000 หรือเปล่า");
      setConnectionState("error");
    };
    ws.onclose = () => {
      setConnectionState((prev) => (prev === "error" ? prev : "closed"));
    };
  }, [isBotSpeaking, resetIdleTimer, setCatStateSafe]);

  useEffect(() => disconnect, [disconnect]); // cleanup ตอน unmount

  return { connectionState, catState, amplitude, transcript, errorMessage, connect, disconnect };
}
