import { useRef, useState } from "react";
import CatFace, { type CatFaceState, useBlink, useGazeLoop } from "./components/character/CatFace";
import CharacterPage from "./components/character/CharacterPage";
import { ControlPanel } from "./components/ControlPanel";
import { LiveVoicePanel } from "./components/LiveVoicePanel";
import { useAmplitude } from "./hooks/useAmplitude";
import { LOCAL_VAD_RMS_THRESHOLD, useVoiceSocket } from "./hooks/useVoiceSocket";
import type { CatState } from "./types";
import "./App.css";

type Mode = "file-test" | "live-voice" | "figma-preview";

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

  // ---- โหมดทดสอบด้วยไฟล์เสียง (เดิม) ----
  const [fileTestState, setFileTestState] = useState<CatState>("idle");
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const { amplitude: fileAmplitude, resume } = useAmplitude(audioEl);

  const handleFileSelected = (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    if (audioEl) {
      audioEl.src = url;
      setHasAudio(true);
    }
  };
  const handlePlay = () => {
    resume();
    audioEl?.play();
    setIsPlaying(true);
    setFileTestState("wake");
  };
  const handlePause = () => {
    audioEl?.pause();
    setIsPlaying(false);
  };
  const handleAudioEnded = () => {
    setIsPlaying(false);
    setFileTestState("transition");
    setTimeout(() => setFileTestState("idle"), 400);
  };

  // ---- โหมดคุยด้วยเสียงจริง (Gemini Live ผ่าน backend WS) ----
  const voice = useVoiceSocket({ debug: isDebug });

  const displayState = mode === "live-voice" ? voice.catState : fileTestState;
  const displayAmplitude = mode === "live-voice" ? voice.amplitude : isPlaying ? fileAmplitude : 0;
  // file-test ไม่มีไมค์ผู้ใช้จริง เสียงที่เล่นคือเสียงแมวเสมอ ("wake" ในโหมดนี้ = กำลังเล่นไฟล์เสียง)
  // และไม่มีแนวคิด "รอ Gemini ตอบ" เลย (ไม่ได้ยิง retrieval จริง) เลย isThinking เป็น false เสมอ
  const displayBotSpeaking = mode === "live-voice" ? voice.botSpeaking : isPlaying;
  const displayIsThinking = mode === "live-voice" ? voice.isThinking : false;
  const displayOffTopic = mode === "live-voice" ? voice.offTopic : false;
  const faceState = toCatFaceState(displayState, displayBotSpeaking, displayIsThinking, displayOffTopic);

  // เดิม App.tsx ไม่เคยส่ง gaze/blink ให้ CatFace เลย (ตาค้างนิ่งตลอด) — ใช้ logic เดียวกับที่
  // CharacterPage.tsx (หน้าพรีวิว) ใช้: กระพริบตลอดยกเว้นตอนหลับ (ถี่ขึ้นตอน thinking ให้ดูต่างจาก
  // listening ชัดเจน — หูก็หยุดสลับกลับเป็นท่าปกติตอน thinking ด้วย ดู CatFace.tsx)
  const blink = useBlink({ enabled: faceState !== "sleeping", rate: faceState === "thinking" ? 0.45 : 1 });
  // ตากลอกย้ายมาไว้ตอน "idle" แทน "listening" (ทดสอบเสียงจริง 2026-09-08) — คนตั้งใจฟังจะจ้องนิ่ง
  // ไม่กรอกตา ส่วนตอน idle (ยังไม่มีใครคุยด้วย) กรอกตาไปมาสื่อว่ากำลังมองรอบ ๆ รอคนมาคุย — หมายเหตุ:
  // ตอนนี้ "idle" ใช้ eyes:"ring" ใน CatFace.tsx (วงกลม outline ไม่มี pupil overlay ให้ขยับเลย ดู
  // showPupils ในไฟล์นั้น) เปลี่ยนแค่ตรงนี้อย่างเดียวจะยังไม่เห็นผลภาพอะไรจนกว่าจะแก้ CatFace.tsx
  // ให้ idle ใช้ eyes:"gaze" ด้วย (ไฟล์นั้นตั้งใจไม่แตะรอบนี้ตามที่สั่ง)
  const gaze = useGazeLoop({ enabled: faceState === "idle" });

  return (
    <div className="app">
      <audio ref={(el) => setAudioEl(el)} onEnded={handleAudioEnded} style={{ display: "none" }} />

      <div className="app-column">
        <div className="mode-tabs">
          <button
            className={`mode-tab ${mode === "live-voice" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("live-voice")}
          >
            คุยด้วยเสียงจริง
          </button>
          <button
            className={`mode-tab ${mode === "file-test" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("file-test")}
          >
            ทดสอบด้วยไฟล์เสียง
          </button>
          <button
            className={`mode-tab ${mode === "figma-preview" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("figma-preview")}
          >
            หน้าใหม่จาก Figma (พรีวิว)
          </button>
        </div>

        {mode === "figma-preview" ? (
          <CharacterPage />
        ) : (
          <div className="app-stage">
            <CatFace state={faceState} amplitude={displayAmplitude} gaze={gaze} blink={blink} />
          </div>
        )}
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
      {mode === "file-test" && (
        <ControlPanel
          state={fileTestState}
          onStateChange={setFileTestState}
          onFileSelected={handleFileSelected}
          onPlay={handlePlay}
          onPause={handlePause}
          isPlaying={isPlaying}
          hasAudio={hasAudio}
          amplitude={fileAmplitude}
        />
      )}

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
