import { useState } from "react";
import CatFace, { CAT_FACE_STATES, STATES, useBlink, useGazeLoop, type CatFaceState } from "./CatFace";
import "./CharacterPage.css";

/**
 * แปลงจาก CharacterPage.jsx (Figma export) — เดิมใช้ class Tailwind ล้วน (bg-neutral-950,
 * rounded-lg, ...) แต่โปรเจกต์นี้ไม่มี Tailwind ติดตั้งอยู่เลย (เช็คแล้วจาก package.json) ทำให้ทุก
 * class เดิมไม่มีผลอะไรบนหน้าจอจริง เขียน CharacterPage.css ใหม่แทนให้ตรงธรรมเนียมไฟล์อื่นในโปรเจกต์
 * (ดู App.css — plain CSS ล้วน ไม่มี framework)
 *
 * ไม่มี react-router-dom ในโปรเจกต์ด้วย (README เดิมบอกให้เพิ่ม <Route path="/character">) —
 * คอมโพเนนต์นี้เลยออกแบบใหม่ให้เป็น "เนื้อหา" เปล่า ๆ ไม่ห่อ full-page wrapper ของตัวเอง
 * ประกอบเป็นแท็บที่ 3 ใน App.tsx ได้ตรง ๆ (ดู App.tsx โหมด "figma-preview")
 *
 * แยก state/controls ออกจาก stage แล้ว (2026-09-10 — จอจริงต้องเป็นหน้าแมวเต็มจอเสมอ ปุ่มทดสอบ
 * ทั้งหมดย้ายไปอยู่ใน hamburger menu แทน ดู App.tsx) — `useFigmaPreviewControls` คุม state/auto
 * ล้วน ๆ, `FigmaPreviewControls` เป็นแค่ปุ่ม/toggle (ไม่มี stage ของตัวเอง) ส่วน `CharacterPage`
 * (default export) ยังคงพฤติกรรมเดิมทั้งหมดไว้เผื่อมีที่ใช้แบบ standalone นอก App.tsx
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
    <>
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
    </>
  );
}

export default function CharacterPage() {
  const controls = useFigmaPreviewControls();

  return (
    <div className="figma-preview">
      <div className="figma-preview__stage">
        <CatFace state={controls.state} gaze={controls.gaze} blink={controls.blink} />
      </div>
      <FigmaPreviewControls {...controls} />
    </div>
  );
}
