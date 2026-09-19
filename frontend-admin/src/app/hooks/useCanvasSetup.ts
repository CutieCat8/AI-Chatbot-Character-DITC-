import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

interface CanvasRect {
  width: number;
  height: number;
}

interface CanvasSetup {
  canvasRef: RefObject<HTMLCanvasElement>;
  rect: RefObject<CanvasRect>;
  isVisible: RefObject<boolean>;
  reducedMotion: boolean;
}

// ที่มา: พอร์ตมาจาก C:\Users\Asus\Desktop\Tle's game\testcpn\src\hooks\useCanvasSetup.ts (โค้ดที่
// codex เขียนไว้ให้ผู้ว่าจ้างแล้ว) — ResizeObserver คุมขนาด canvas.width/height ตาม dpr เอง +
// IntersectionObserver/visibilitychange พัก draw loop ตอนไม่เห็น canvas บนจอ ประหยัด CPU
export function useCanvasSetup(): CanvasSetup {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const rect = useRef<CanvasRect>({ width: 0, height: 0 });
  const isVisible = useRef(true);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia("(max-width: 768px)").matches),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      rect.current = { width, height };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    });
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry) isVisible.current = entry.isIntersecting;
      },
      { rootMargin: "100px" },
    );
    const handleVisibility = () => {
      isVisible.current = document.visibilityState === "visible";
    };

    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return { canvasRef, rect, isVisible, reducedMotion };
}
