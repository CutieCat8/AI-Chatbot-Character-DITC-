import { useEffect, useRef, useState } from "react";
import "./ClippedCircle.css";

interface ClippedCircleProps {
  /** เส้นผ่านศูนย์กลางวงกลม (px) */
  size?: number;
  /**
   * สีพื้นของวงกลม (ก่อน mix-blend-mode:"difference") — ตัวนี้เองที่กำหนดสีผลลัพธ์บนพื้นหลังต่างๆ:
   * diff(ขาว, ขาว)=ดำ, diff(ดำ, ขาว)=ขาว, diff(ดำ, เทา)=เทา ดูตัวอย่างการใช้จริงที่ App.tsx
   * (ปุ่ม mode-tab ที่เลือกอยู่พื้นดำ ใช้สีเทาแทนขาวเพื่อไม่ให้เอฟเฟกต์จ้าเกินไป)
   */
  color?: string;
  className?: string;
}

/**
 * เอฟเฟกต์ "spotlight ตามเมาส์" ที่ผู้ใช้ก็อปมาจาก unlumen-ui
 * (https://unlumen-ui-docs.vercel.app/docs/ui/effects/clipped-circle) — วงกลมโปร่งแสงลอยตามตำแหน่ง
 * เมาส์ในกรอบ parent แล้วใช้ mix-blend-mode:"difference" ให้ดูเหมือนแสงส่องกลับสี พร้อม scale
 * เข้า/ออกตอน hover/leave
 *
 * ต้นฉบับใช้ Framer Motion (`motion/react`) แต่โปรเจกต์นี้ไม่มีไลบรารีนั้นติดตั้งอยู่ (เช็ค
 * package.json แล้ว) เขียนใหม่ด้วย useState + CSS transition ล้วน ๆ ให้พฤติกรรมเหมือนต้นฉบับ
 * ทุกประการ (ตำแหน่งตามเมาส์แบบเปอร์เซ็นต์ของ parent, scale 0→1 คูณด้วย easing
 * cubic-bezier(0.19, 1, 0.22, 1) ระยะเวลา 500ms) — วาง component นี้เป็นลูกของ container ที่มี
 * `position: relative; overflow: hidden;` เท่านั้น (ดู .hamburger-drawer__header ใน
 * HamburgerMenu.css) ตัว component เองแนบ listener ไว้ที่ parentElement โดยตรง ไม่ต้องส่ง ref เข้ามา
 */
export function ClippedCircle({ size = 260, color = "#fff", className = "" }: ClippedCircleProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState({ x: "50%", y: "50%" });

  useEffect(() => {
    const parent = layerRef.current?.parentElement;
    if (!parent) return;

    const updatePosition = (e: MouseEvent) => {
      const rect = parent.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setPosition({ x: `${x}%`, y: `${y}%` });
    };
    const handleEnter = (e: MouseEvent) => {
      updatePosition(e);
      setHovered(true);
    };
    const handleLeave = () => setHovered(false);

    parent.addEventListener("mouseenter", handleEnter);
    parent.addEventListener("mousemove", updatePosition);
    parent.addEventListener("mouseleave", handleLeave);
    return () => {
      parent.removeEventListener("mouseenter", handleEnter);
      parent.removeEventListener("mousemove", updatePosition);
      parent.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  return (
    <div ref={layerRef} className={`clipped-circle-layer ${className}`}>
      <div
        className={`clipped-circle ${hovered ? "clipped-circle--visible" : ""}`}
        style={{ left: position.x, top: position.y, width: size, height: size, background: color }}
      />
    </div>
  );
}
