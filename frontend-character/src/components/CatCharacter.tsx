import { useEffect, useState } from "react";
import type { CatState } from "../types";
import "./CatCharacter.css";

interface Props {
  state: CatState;
  amplitude: number; // 0-1 จาก useAmplitude — ขับเคลื่อนการอ้าปาก (lip-flap)
}

/**
 * หน้าแมวแบบ placeholder (SVG ล้วน วาดเอง ไม่ใช่ art จริง) — ตั้งใจทำให้ไฟล์เดียว เปลี่ยนมาใช้
 * Rive/Lottie จริงทีหลังได้ง่าย แค่เปลี่ยนเนื้อใน component นี้ ส่วน props (state, amplitude)
 * และ hook (useAmplitude) ใช้ต่อได้เลยไม่ต้องแก้ที่เรียกใช้
 *
 * ปากอ้า-หุบตาม "amplitude" เท่านั้น (ไม่ใช่ viseme-accurate) ตามที่ Scope ระบุว่า "ไม่ต้องเป๊ะ"
 * ตากระพริบสุ่มเป็นระยะเฉพาะตอน idle/web ให้ดูมีชีวิตชีวา ไม่นิ่งทื่อ
 */
export function CatCharacter({ state, amplitude }: Props) {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (state === "sleep" || state === "wake") return; // sleep หลับตาอยู่แล้ว, wake ไม่ให้กระพริบทับ
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      const delay = 2000 + Math.random() * 3000; // กระพริบทุก 2-5 วิ สุ่ม ๆ ให้ดูเป็นธรรมชาติ
      timeoutId = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => setBlinking(false), 150);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(timeoutId);
  }, [state]);

  const isSleeping = state === "sleep";
  const isWake = state === "wake";
  const eyesClosed = isSleeping || blinking;

  // ปากอ้าตาม amplitude — ตอน sleep ไม่ขยับปากเลย (ไม่มีเสียงพูดตอนหลับ)
  const mouthOpenRy = isSleeping ? 1 : 4 + amplitude * 22;

  return (
    <div className={`cat-character cat-character--${state}`}>
      <svg viewBox="0 0 200 200" width="280" height="280" role="img" aria-label={`แมว สถานะ ${state}`}>
        {/* หู */}
        <polygon points="40,60 65,10 85,55" className="cat-ear" />
        <polygon points="160,60 135,10 115,55" className="cat-ear" />

        {/* หัว */}
        <circle cx="100" cy="105" r="75" className="cat-head" />

        {/* ตา */}
        <g className="cat-eye-group">
          {eyesClosed ? (
            <>
              <path d="M 60 100 Q 72 108 84 100" className="cat-eye-closed" />
              <path d="M 116 100 Q 128 108 140 100" className="cat-eye-closed" />
            </>
          ) : (
            <>
              <circle cx="72" cy="100" r={isWake ? 13 : 10} className="cat-eye" />
              <circle cx="128" cy="100" r={isWake ? 13 : 10} className="cat-eye" />
              <circle cx="74" cy="97" r="3.5" className="cat-eye-shine" />
              <circle cx="130" cy="97" r="3.5" className="cat-eye-shine" />
            </>
          )}
        </g>

        {/* จมูก */}
        <polygon points="96,120 104,120 100,126" className="cat-nose" />

        {/* ปาก — ellipse ที่ ry ขยับตาม amplitude */}
        <ellipse cx="100" cy="134" rx="14" ry={mouthOpenRy} className="cat-mouth" />

        {/* หนวด */}
        <line x1="20" y1="115" x2="55" y2="112" className="cat-whisker" />
        <line x1="20" y1="128" x2="55" y2="128" className="cat-whisker" />
        <line x1="180" y1="115" x2="145" y2="112" className="cat-whisker" />
        <line x1="180" y1="128" x2="145" y2="128" className="cat-whisker" />
      </svg>

      {state === "sleep" && <div className="cat-zzz">Z z z</div>}
      {state === "web" && (
        <div className="cat-thinking">
          <span className="cat-thinking-dot" />
          <span className="cat-thinking-dot" />
          <span className="cat-thinking-dot" />
        </div>
      )}
    </div>
  );
}
