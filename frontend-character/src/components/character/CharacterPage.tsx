import { useState } from "react";
import { CAT_FACE_STATES, STATES, useBlink, useGazeLoop, type CatFaceState } from "./CatFace";
import "./CharacterPage.css";

/**
 * เดิมไฟล์นี้ export default `CharacterPage` เป็นหน้าเต็มของตัวเอง (จอมืด + ปุ่มควบคุมในหน้าเดียวกัน)
 * — แยก state/controls ออกจาก stage ไปแล้ว (2026-09-10 — จอจริงต้องเป็นหน้าแมวเต็มจอเสมอ ปุ่มทดสอบ
 * ทั้งหมดย้ายไปอยู่ใน hamburger menu แทน ดู App.tsx) ทำให้ default export ไม่มีใครเรียกใช้อีกต่อไป
 * (เช็คแล้วด้วย grep — ไม่มีที่ import แบบ default จากไฟล์นี้เหลือเลย) ลบทิ้งแล้ว (2026-09-11)
 *
 * ไฟล์นี้ตอนนี้ export แค่ 2 อย่าง: `useFigmaPreviewControls` (คุม state/auto/blink/gaze ล้วนๆ
 * ไม่มี stage) กับ `FigmaPreviewControls` (ปุ่ม/toggle ให้ App.tsx เอาไปวางในลิ้นชักคู่กับ fullscreen
 * stage ตัวเดียวกับโหมดอื่น — ดู App.tsx โหมด "figma-preview")
 */

const LABEL: Record<CatFaceState, string> = {
  sleeping: "หลับ",
  waking: "โดนปลุก",
  listening: "กำลังฟัง",
  thinking: "กำลังคิด",
  speaking: "กำลังตอบ",
  idle: "ว่าง",
  angry: "นอกขอบเขต",
};

export function useFigmaPreviewControls() {
  const [state, setState] = useState<CatFaceState>("idle");
  const [auto, setAuto] = useState(true);

  // กระพริบถี่ขึ้นตอนกำลังคิด ไม่กระพริบเลยตอนหลับ
  const blink = useBlink({
    enabled: auto && state !== "sleeping",
    rate: state === "thinking" ? 0.45 : 1,
  });

  // ตากลอกเฉพาะตอนกำลังฟัง
  const gaze = useGazeLoop({ enabled: auto && state === "listening" });

  return { state, setState, auto, setAuto, blink, gaze };
}

type FigmaPreviewControlsProps = Pick<
  ReturnType<typeof useFigmaPreviewControls>,
  "state" | "setState" | "auto" | "setAuto" | "gaze"
>;

export function FigmaPreviewControls({ state, setState, auto, setAuto, gaze }: FigmaPreviewControlsProps) {
  return (
    <div className="figma-preview-panel">
      <div className="figma-preview__buttons">
        {CAT_FACE_STATES.map((s) => (
          <button
            key={s}
            onClick={() => setState(s)}
            className={`figma-preview__btn ${state === s ? "figma-preview__btn--active" : ""}`}
          >
            {LABEL[s]}
          </button>
        ))}
      </div>

      <label className="figma-preview__toggle">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        เปิดกะพริบตา / ตากลอกอัตโนมัติ
      </label>

      <p className="figma-preview__meta">
        state: <code>{state}</code> · gaze: <code>[{gaze.join(", ")}]</code> ·{" "}
        {Object.keys(STATES).length} states
      </p>
    </div>
  );
}
