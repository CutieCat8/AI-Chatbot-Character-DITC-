import { useState } from "react";
import CatFace, { type CatFaceState, useBlink, useGazeLoop } from "./components/character/CatFace";
import { FigmaPreviewControls, useFigmaPreviewControls } from "./components/character/CharacterPage";
import { ClippedCircle } from "./components/ClippedCircle";
import { HamburgerMenu } from "./components/HamburgerMenu";
import { LiveVoicePanel } from "./components/LiveVoicePanel";
import { LOCAL_VAD_RMS_THRESHOLD, useVoiceSocket } from "./hooks/useVoiceSocket";
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
  switch (state) {
    case "sleep":
      return "sleeping";
    case "wake":
      if (botSpeaking) return "speaking";
      if (isThinking) return "thinking";
      return "listening";
    case "transition":
    case "idle":
    default:
      return "idle";
  }
}

// ?debug=1 เปิด overlay โชว์ RMS/threshold สดของ local VAD — ไว้ให้ผู้ใช้ทดสอบด้วยเสียงจริงแล้ว
// ตัดสินใจเรื่องปรับ threshold/hangover ร่วมกัน (ยังไม่แก้ logic การตรวจจับใด ๆ ในรอบนี้)
const isDebug = new URLSearchParams(window.location.search).get("debug") === "1";

export function App() {
  const [mode, setMode] = useState<Mode>("live-voice");

  // ---- โหมดคุยด้วยเสียงจริง (Gemini Live ผ่าน backend WS) ----
  const voice = useVoiceSocket({ debug: isDebug });

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
            onConnect={voice.connect}
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
    </div>
  );
}
