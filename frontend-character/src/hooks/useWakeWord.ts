import { useEffect, useRef, useState } from "react";

export type WakeWordListenerStatus = "unsupported" | "disabled" | "listening" | "error";

interface WakeWordOptions {
  /** ฟังเฉพาะตอนนี้เป็น true (เช่น ยังไม่ได้เริ่มคุยจริง ไม่มีไมค์ตัวอื่นแย่งใช้อยู่) hook นี้เองไม่รู้
   * ด้วยซ้ำว่ามี useVoiceSocket ใช้ไมค์อีกตัวอยู่ — ผู้เรียกต้องคุม enabled เองให้ปิดตอนคุยจริง */
  enabled: boolean;
  onDetected: () => void;
  /** คำปลุก เทียบแบบ substring (ไม่ fuzzy) หลังตัด whitespace ทั้งหมดออก */
  phrase?: string;
  lang?: string;
  /** debug/diagnostic เท่านั้น — เห็น transcript สดจาก engine เพื่อดูว่าทำไมไม่ติด/ติดผิด */
  onTranscript?: (transcript: string, isFinal: boolean) => void;
}

// Web Speech API ไม่อยู่ใน TS lib.dom.d.ts มาตรฐาน (ยังไม่ standardize เต็มตัว) — ประกาศ type เอง
// เท่าที่ใช้จริงเท่านั้น ไม่ copy ทั้ง spec มา
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const DETECTION_COOLDOWN_MS = 4_000;
const RESTART_DELAY_MS = 300;

function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * ปลุกด้วยเสียงผ่าน Web Speech API (การรู้จำเสียงพูดในตัวเบราว์เซอร์ — Chrome ใช้ engine รู้จำเสียง
 * ของ Google บนคลาวด์) แทนการเทรนโมเดล keyword-spotting เอง — เพื่อนลองเทรนโมเดลเองมาก่อนแล้ว
 * (`docs/superpowers/specs/2026-09-08-wake-word-*.md` ใน branch `feat/wake-word` ที่ยังไม่ merge)
 * แต่ dataset เล็กเกินไปสำหรับเทรนโมเดลเสียงจากศูนย์ให้แม่น (เจ้าของงานทดสอบเองบางทียังไม่ติด คนอื่น
 * พูดยิ่งไม่ติดเลย) เปลี่ยนมาใช้เอนจินที่เทรนมาด้วยข้อมูลเสียงมหาศาลอยู่แล้วแทน ไม่ต้องเทรนอะไรเองเลย
 *
 * ทำงานแบบ continuous + interimResults เพื่อความไว เช็คทุก transcript ที่ได้ (ทั้ง interim/final)
 * ว่ามีคำปลุกอยู่หรือไม่แบบ substring match ธรรมดา (คำปลุกง่ายพอที่ไม่น่าพลาดชื่อเพี้ยนบ่อย)
 *
 * ⚠️ ยังไม่ได้ทดสอบบนแท็บเล็ตจริง (Galaxy Tab S10 FE+) — SpeechRecognition โหมด continuous บน
 * Chrome Android เคยมีรายงานว่าพฤติกรรมไม่เสถียรเท่า desktop ในบางเวอร์ชัน ต้องทดสอบจริงก่อนเชื่อว่า
 * ใช้งานได้ต่อเนื่องทั้งวัน (ดู CLAUDE.md ข้อ 1 — ห้ามอ้างว่าทดสอบแล้วถ้าไม่ได้ทำ)
 */
export function useWakeWord({
  enabled,
  onDetected,
  phrase = "สวัสดี",
  lang = "th-TH",
  onTranscript,
}: WakeWordOptions): WakeWordListenerStatus {
  const [status, setStatus] = useState<WakeWordListenerStatus>("disabled");
  const callbackRef = useRef(onDetected);
  const transcriptCallbackRef = useRef(onTranscript);
  const lastDetectedAtRef = useRef(0);
  useEffect(() => {
    callbackRef.current = onDetected;
  }, [onDetected]);
  useEffect(() => {
    transcriptCallbackRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    if (!enabled) {
      setStatus("disabled");
      return;
    }

    let disposed = false;
    let fatalError = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    const target = normalize(phrase);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    const scheduleRestart = () => {
      if (disposed || fatalError) return;
      restartTimer = setTimeout(() => {
        if (disposed || fatalError) return;
        try {
          recognition.start();
        } catch {
          // start() บนตัวที่ยังรันอยู่โยน error — เกิดได้ตอน onend/onerror ยิงซ้อนกัน ปล่อยผ่านแล้ว
          // รอ onend รอบถัดไป restart อีกทีพอ ไม่ต้อง handle ซ้ำ
        }
      }, RESTART_DELAY_MS);
    };

    recognition.onstart = () => {
      if (!disposed) setStatus("listening");
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        transcriptCallbackRef.current?.(transcript, result.isFinal);
        if (normalize(transcript).includes(target)) {
          const now = performance.now();
          if (now - lastDetectedAtRef.current > DETECTION_COOLDOWN_MS) {
            lastDetectedAtRef.current = now;
            callbackRef.current();
          }
        }
      }
    };

    recognition.onerror = (event) => {
      // "no-speech" เกิดปกติมากตอนไม่มีใครพูดนาน ๆ ในโหมด continuous — ไม่ใช่ error จริง ปล่อยให้
      // onend สั่ง restart ต่อไปเฉย ๆ ไม่ต้อง log/เปลี่ยน status ให้ดูเหมือนพัง
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        // ผู้ใช้ปฏิเสธสิทธิ์ไมค์ (หรือ browser บล็อกเอง) — restart รัว ๆ ไปก็ยิ่ง error รัว ๆ เหมือนเดิม
        // หยุดพยายามเลยจนกว่า `enabled` จะ toggle ใหม่จากภายนอก (เช่น รีเฟรชหน้า)
        fatalError = true;
        console.warn("Wake-word listener: ไม่ได้รับสิทธิ์ไมค์");
      } else {
        console.warn("Wake-word listener error:", event.error);
      }
      if (!disposed) setStatus("error");
    };

    recognition.onend = () => {
      scheduleRestart();
    };

    try {
      recognition.start();
    } catch (error) {
      console.warn("Wake-word listener failed to start:", error);
      setStatus("error");
    }

    return () => {
      disposed = true;
      if (restartTimer) clearTimeout(restartTimer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition.abort();
    };
  }, [enabled, lang, phrase]);

  return status;
}
