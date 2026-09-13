import { useEffect, useState } from "react";
import CatFace, { type CatFaceState, useBlink, useGazeLoop } from "./components/character/CatFace";
import { FigmaPreviewControls, useFigmaPreviewControls } from "./components/character/CharacterPage";
import { ClippedCircle } from "./components/ClippedCircle";
import { HamburgerMenu } from "./components/HamburgerMenu";
import { LiveVoicePanel } from "./components/LiveVoicePanel";
import { LOCAL_VAD_RMS_THRESHOLD, useVoiceSocket } from "./hooks/useVoiceSocket";
import { useWakeWord } from "./hooks/useWakeWord";
import { formatWakeLog } from "./lib/wakeLog";
import type { CatState } from "./types";
import "./App.css";

type Mode = "live-voice" | "figma-preview";

/**
 * แปลง CatState เดิม (4 ค่าตามสโคป TOR จริง: Idle/Transition/Sleep/Wake) เป็น CatFaceState ใหม่
 * (7 render-state จาก Figma) — ดูตารางแมปเต็มที่ CLAUDE.md หัวข้อ "ข้อกำหนดที่ห้ามละเมิด"
 *
 * จุดที่ต้องแยกเอง: catState==="wake" เดิมตั้งทั้งตอนผู้ใช้พูด, ตอนแมวพูด, และตอนรอ Gemini ตอบ
 * (ดูคอมเมนต์ใน useVoiceSocket.ts) แยกด้วย `botSpeaking`/`isThinking` ที่เพิ่มเข้ามาต่างหาก:
 *   - botSpeaking=true  -> "speaking" (ปากขยับตาม amplitude จริง)
 *   - isThinking=true   -> "thinking" (หยุดพูดแล้ว รอคำตอบ — ต้องแยกจาก listening ให้ชัด ไม่งั้น
 *                          ผู้ใช้เห็นแมวเหมือนยังฟังอยู่ทั้งที่พูดจบไปแล้ว อาจพูดซ้ำเพราะนึกว่าไม่ได้ยิน)
 *   - ไม่เข้าเงื่อนไขไหนเลย -> "listening" (กำลังฟังผู้ใช้พูดอยู่จริง)
 */
/**
 * `offTopic` มาจาก flag เชิงโครงสร้างที่ backend ส่งมาจริง (Gemini เรียก tool flag_off_topic เอง —
 * ดู useVoiceSocket.ts) ไม่ใช่การเดา ชนะทุก state อื่นตอนยัง true อยู่ (หมดอายุเองพร้อม "wake" ที่
 * useVoiceSocket.ts จัดการไว้แล้ว ไม่ต้อง reset ซ้ำที่นี่)
 */
function toCatFaceState(state: CatState, botSpeaking: boolean, isThinking: boolean, offTopic: boolean): CatFaceState {
  if (offTopic) return "angry";
  // botSpeaking ต้องชนะ catState เสมอ ไม่ใช่แค่ใต้ case "wake" (2026-09-14 — เจอจริงตอนต่อ
  // greet-first: catState ยังเป็น "idle" อยู่ตอน ws.onopen แล้วรอ tick() เห็น isBotSpeaking()===true
  // ค่อยเปลี่ยนเป็น "wake" — มีช่วงสั้น ๆ ที่เสียงทักทายเริ่มเล่นแล้วแต่ catState ยังไม่ทันอัปเดต ถ้า
  // เช็คแค่ใต้ case "wake" ตาจะค้าง idle ปากไม่ขยับทั้งที่มีเสียงพูดออกมาจริง)
  if (botSpeaking) return "speaking";
  switch (state) {
    case "sleep":
      return "sleeping";
    case "wake":
      if (isThinking) return "thinking";
      return "listening";
    case "transition":
    case "idle":
    default:
      return "idle";
  }
}

// ?debug=1 เปิด overlay โชว์ RMS/threshold สดของ local VAD + สถานะ wake-word — ไว้ให้ผู้ใช้ทดสอบ
// ด้วยเสียงจริงแล้วตัดสินใจเรื่องปรับ threshold/hangover ร่วมกัน (ยังไม่แก้ logic การตรวจจับใด ๆ
// ในรอบนี้)
const isDebug = new URLSearchParams(window.location.search).get("debug") === "1";

export function App() {
  const [mode, setMode] = useState<Mode>("live-voice");

  // ---- โหมดคุยด้วยเสียงจริง (Gemini Live ผ่าน backend WS) ----
  const voice = useVoiceSocket({ debug: isDebug });

  // ---- ปลุกด้วยเสียง (ดู useWakeWord.ts) — เปิดใช้งานจริงเป็น default แล้ว (2026-09-13 ตามคำสั่ง
  // เจ้าของงาน ไม่รอผ่านเกณฑ์ "ทดสอบกับผู้ใช้จริงหลายคน" ตามสโคปเดิมก่อน — ตัดสินใจของเจ้าของงานเอง
  // ไม่ใช่ผมตัดสินใจแทน ดู CLAUDE.md หัวข้อ "ฟีเจอร์ในสโคปที่ยังไม่ได้ทำ" สำหรับสถานะเต็ม) เดิมล็อกไว้
  // หลัง ?wakeword=1 เอาออกแล้ว ยังไม่เคยทดสอบด้วยไมค์จริงเลยสักครั้ง (ดู useWakeWord.ts) ห้ามอ้างว่า
  // ทดสอบแล้วจนกว่าจะลองพูดจริงบนแท็บเล็ต/เบราว์เซอร์จริง
  const [wakeWordTranscript, setWakeWordTranscript] = useState("");
  const wakeWordStatus = useWakeWord({
    // ฟังเฉพาะตอนยังไม่ได้เริ่มคุยจริงเท่านั้น — ไมค์อีกตัวใน useVoiceSocket.ts (ตอน connect())
    // ต้องไม่ถูกแย่งจากตัวนี้ ปิดทันทีที่เริ่มเชื่อมต่อจริงไม่ว่าจะด้วยปุ่มหรือคำปลุกเอง
    enabled:
      mode === "live-voice" &&
      (voice.catState === "idle" || voice.catState === "sleep") &&
      (voice.connectionState === "idle" || voice.connectionState === "closed"),
    // greetFirst: เฉพาะทางนี้เท่านั้น — ปุ่ม "เริ่มคุย" ที่ LiveVoicePanel เรียก voice.connect() ตรงๆ
    // ไม่มี flag นี้ ยังรอผู้ใช้พูดก่อนตามเดิม (ผู้ใช้กดปุ่มเองอยู่แล้ว ต่างจาก wake-word ที่ไม่มีปุ่ม
    // ให้กดยืนยันอีกที) ดู GREET_FIRST_MESSAGE ใน backend/app/routers/voice.py
    onDetected: () => { void voice.connect({ greetFirst: true }); },
    onTranscript: isDebug ? (transcript) => setWakeWordTranscript(transcript) : undefined,
  });

  // ?debug=1: หาง log ล่าสุด (ดู lib/wakeLog.ts) แบบ realtime ในหน้าเลย — ไม่ต้องพึ่ง console/
  // window.__wakeLog() อย่างเดียว เจ้าของงานทดสอบด้วยเสียงจริงต้องเห็นทันทีว่า match/abort/end/
  // connect เกิดตอนไหนบ้างโดยไม่ต้องสลับไปเปิด devtools ระหว่างพูด (poll แทน event เพราะ log มาจาก
  // native callback ของ SpeechRecognition/WebSocket หลายจุด ทำ pub/sub ทุกจุดเกินความจำเป็นของ
  // debug overlay ที่ไม่ได้โชว์ตลอดเวลาอยู่แล้ว)
  const [wakeLogTail, setWakeLogTail] = useState<string>("");
  useEffect(() => {
    if (!isDebug) return;
    const id = setInterval(() => {
      setWakeLogTail(formatWakeLog().split("\n").slice(-10).join("\n"));
    }, 250);
    return () => clearInterval(id);
  }, [isDebug]);

  // ---- โหมดพรีวิวหน้าใหม่จาก Figma (เดิม CharacterPage.tsx คุมเอง แยก state/controls ออกมาแล้ว
  // เพื่อขับ stage เต็มจอตัวเดียวกันกับโหมดอื่น ดู CharacterPage.tsx) ----
  const figma = useFigmaPreviewControls();

  // เดิม App.tsx ไม่เคยส่ง gaze/blink ให้ CatFace เลย (ตาค้างนิ่งตลอด) — ใช้ logic เดียวกับที่
  // CharacterPage.tsx (หน้าพรีวิว) ใช้: กระพริบตลอดยกเว้นตอนหลับ (ถี่ขึ้นตอน thinking ให้ดูต่างจาก
  // listening ชัดเจน — หูก็หยุดสลับกลับเป็นท่าปกติตอน thinking ด้วย ดู CatFace.tsx)
  // ใช้ได้เฉพาะโหมด live-voice — โหมด figma-preview มี state/blink/gaze ของตัวเองจาก
  // useFigmaPreviewControls() (มี toggle "auto" แยกต่างหาก เก็บพฤติกรรมเดิมของหน้าพรีวิวไว้ครบ)
  const liveFaceState = toCatFaceState(voice.catState, voice.botSpeaking, voice.isThinking, voice.offTopic);
  const liveBlink = useBlink({ enabled: liveFaceState !== "sleeping", rate: liveFaceState === "thinking" ? 0.45 : 1 });
  // ตากลอกย้ายมาไว้ตอน "idle" แทน "listening" (ทดสอบเสียงจริง 2026-09-08) — คนตั้งใจฟังจะจ้องนิ่ง
  // ไม่กรอกตา ส่วนตอน idle (ยังไม่มีใครคุยด้วย) กรอกตาไปมาสื่อว่ากำลังมองรอบ ๆ รอคนมาคุย — หมายเหตุ:
  // ตอนนี้ "idle" ใช้ eyes:"ring" ใน CatFace.tsx (วงกลม outline ไม่มี pupil overlay ให้ขยับเลย ดู
  // showPupils ในไฟล์นั้น) เปลี่ยนแค่ตรงนี้อย่างเดียวจะยังไม่เห็นผลภาพอะไรจนกว่าจะแก้ CatFace.tsx
  // ให้ idle ใช้ eyes:"gaze" ด้วย (ไฟล์นั้นตั้งใจไม่แตะรอบนี้ตามที่สั่ง)
  const liveGaze = useGazeLoop({ enabled: liveFaceState === "idle" });

  const faceState = mode === "figma-preview" ? figma.state : liveFaceState;
  const activeAmplitude = mode === "figma-preview" ? 0 : voice.amplitude;
  const activeBlink = mode === "figma-preview" ? figma.blink : liveBlink;
  const activeGaze = mode === "figma-preview" ? figma.gaze : liveGaze;

  return (
    <div className="app">
      {/* จอจริงต้องเป็นหน้าแมวเต็มจอเสมอ (2026-09-10 — ดู CLAUDE.md) เต็มทุกโหมด ไม่ใช่แค่ live-voice
          ปุ่ม/แผงควบคุมทั้งหมดที่เคยเรียงข้าง ๆ ย้ายไปอยู่ใน HamburgerMenu มุมขวาบนแทน */}
      <div className="app-stage">
        <CatFace state={faceState} amplitude={activeAmplitude} gaze={activeGaze} blink={activeBlink} />
      </div>

      <HamburgerMenu>
        <div className="mode-tabs">
          {/* สี ClippedCircle ต่างกันตาม active/inactive (2026-09-11 — ผู้ใช้ทักว่าปุ่มที่เลือกอยู่
              (พื้นดำ) เจอ hover แล้วขาวจ้าเกินไป): ปุ่มที่ยังไม่ถูกเลือก (พื้นขาว) ใช้สีขาว diff(ขาว,
              ขาว)=ดำ ตามที่ต้องการ ส่วนปุ่มที่เลือกอยู่ (พื้นดำ #1a1a1a) เปลี่ยนวงกลมเป็นสีเทาแทนขาว
              diff(ดำ, เทา)=เทา แทนที่จะจ้าขาวเหมือนเดิม */}
          <button
            className={`mode-tab ${mode === "live-voice" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("live-voice")}
          >
            <span className="mode-tab__label">Voice Chat</span>
            <ClippedCircle size={130} color={mode === "live-voice" ? "#8a8a8a" : "#fff"} />
          </button>
          <button
            className={`mode-tab ${mode === "figma-preview" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("figma-preview")}
          >
            <span className="mode-tab__label">Preview</span>
            <ClippedCircle size={130} color={mode === "figma-preview" ? "#8a8a8a" : "#fff"} />
          </button>
        </div>

        {mode === "live-voice" && (
          <LiveVoicePanel
            connectionState={voice.connectionState}
            transcript={voice.transcript}
            errorMessage={voice.errorMessage}
            // ห้ามส่ง voice.connect ตรงๆ — LiveVoicePanel ผูกกับ onClick ซึ่งจะส่ง MouseEvent มาเป็น
            // arg ตัวแรก (กลายเป็น options ของ connect() โดยไม่ตั้งใจ) ปุ่มนี้ต้องไม่มี greetFirst เสมอ
            onConnect={() => voice.connect()}
            onDisconnect={voice.disconnect}
          />
        )}
        {mode === "figma-preview" && <FigmaPreviewControls {...figma} />}
      </HamburgerMenu>

      {isDebug && mode === "live-voice" && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            background: "rgba(0,0,0,0.75)",
            color: "#0f0",
            fontFamily: "monospace",
            fontSize: 13,
            padding: "10px 14px",
            borderRadius: 8,
            lineHeight: 1.6,
            pointerEvents: "none",
            zIndex: 999,
          }}
        >
          <div>?debug=1 — local VAD (useVoiceSocket.ts)</div>
          <div>threshold: {LOCAL_VAD_RMS_THRESHOLD.toFixed(4)}</div>
          <div>
            rms: {(voice.debugVad?.rms ?? 0).toFixed(4)}{" "}
            {voice.debugVad && (voice.debugVad.rms > LOCAL_VAD_RMS_THRESHOLD ? "(> threshold)" : "(<= threshold)")}
          </div>
          <div>isSpeechNow: {String(voice.debugVad?.isSpeechNow ?? false)}</div>
          <div>wasSpeech: {String(voice.debugVad?.wasSpeech ?? false)}</div>
          <div>offTopic: {String(voice.offTopic)}</div>
        </div>
      )}

      {isDebug && mode === "live-voice" && (
        <div
          style={{
            position: "fixed",
            bottom: 12,
            left: 12,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 13,
            padding: "10px 14px",
            borderRadius: 8,
            lineHeight: 1.6,
            pointerEvents: "none",
            zIndex: 999,
            maxWidth: 280,
          }}
        >
          <div>?debug=1 — wake-word (useWakeWord.ts)</div>
          <div>listener: {wakeWordStatus}</div>
          <div>connectionState: {voice.connectionState}</div>
          <div>คำปลุก: "สวัสดี"</div>
          <div>transcript ล่าสุด: {wakeWordTranscript || "(ยังไม่มี)"}</div>
          <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.3)", paddingTop: 6 }}>
            log ล่าสุด (เต็มดู console.log ผ่าน window.__wakeLog()):
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11, opacity: 0.9 }}>{wakeLogTail}</pre>
          <button
            style={{ marginTop: 6, pointerEvents: "auto", fontFamily: "monospace", fontSize: 12 }}
            onClick={() => {
              const text = window.__wakeLog?.() ?? "";
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
          >
            ก๊อป log ทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}
