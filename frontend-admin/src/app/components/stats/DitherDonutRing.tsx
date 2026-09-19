import { useEffect, useRef } from "react";
import { useCanvasSetup } from "../../hooks/useCanvasSetup";

export interface DitherDonutSlice {
  key: string;
  value: number;
  color: string; // hex — ใช้เป็นสีจุดของสไลซ์นี้ตรง ๆ
}

interface DitherDonutRingProps {
  slices: DitherDonutSlice[];
  activeIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  size?: number;
}

// วาดเป็นสี่เหลี่ยมเล็ก ๆ ไล่ความหนาแน่น/ขนาดแบบมีคลื่นวิ่งวนรอบวงตลอดเวลา (ไม่ใช่จุดวงกลมนิ่ง ๆ
// แบบที่เคยทำรอบแรก) — พอร์ตอัลกอริทึมมาจาก C:\Users\Asus\Desktop\Tle's game\testcpn\src\components\
// ui\dither-donut.tsx ที่ codex เขียนสำเร็จไว้แล้วให้ผู้ว่าจ้าง (2026-09-19) แทนที่จะพยายามเดาเขียนเอง
// ใหม่จากภาพอ้างอิงอย่างเดียว — เก็บพารามิเตอร์/สูตรคลื่นไว้เหมือนต้นฉบับเกือบทั้งหมด เปลี่ยนแค่ให้
// รับข้อมูล slices ตามจริง (ต้นฉบับ hardcode แผน 5 อันไว้) แทน

const smoothstep = (min: number, max: number, value: number) => {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
};

const hash = (x: number, y: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

const rgba = (hex: string, alpha: number) => {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// วาดวงแหวนเป็นชิ้น ๆ แบบมุมมน (radius โค้งตรงหัว-ท้ายชิ้น) ในพื้นที่พิกัด virtual 200x200 คงที่
// เสมอ (ไม่ผูกกับขนาด canvas จริง) แล้วค่อย scale ทีเดียวตอน ctx.scale ก่อนวาด — พอร์ตมาเป๊ะจากต้นฉบับ
function roundedWedge(
  ctx: CanvasRenderingContext2D,
  inner: number,
  outer: number,
  start: number,
  end: number,
) {
  const radius = Math.min(6, (outer - inner) / 2, ((end - start) * inner) / 2);
  if (end - start <= 0.001) return;
  const innerStart = start + radius / inner;
  const innerEnd = end - radius / inner;
  const outerStart = start + radius / outer;
  const outerEnd = end - radius / outer;

  ctx.moveTo(100 + inner * Math.cos(innerStart), 100 + inner * Math.sin(innerStart));
  ctx.arc(100, 100, inner, innerStart, innerEnd);
  ctx.arcTo(
    100 + inner * Math.cos(end),
    100 + inner * Math.sin(end),
    100 + outer * Math.cos(end),
    100 + outer * Math.sin(end),
    radius,
  );
  ctx.arcTo(
    100 + outer * Math.cos(end),
    100 + outer * Math.sin(end),
    100 + outer * Math.cos(outerEnd),
    100 + outer * Math.sin(outerEnd),
    radius,
  );
  ctx.arc(100, 100, outer, outerEnd, outerStart, true);
  ctx.arcTo(
    100 + outer * Math.cos(start),
    100 + outer * Math.sin(start),
    100 + inner * Math.cos(start),
    100 + inner * Math.sin(start),
    radius,
  );
  ctx.arcTo(
    100 + inner * Math.cos(start),
    100 + inner * Math.sin(start),
    100 + inner * Math.cos(innerStart),
    100 + inner * Math.sin(innerStart),
    radius,
  );
}

const normalizeAngle = (a: number) => {
  let x = a % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x;
};

export function DitherDonutRing({ slices, activeIndex, onHoverIndex, size = 170 }: DitherDonutRingProps) {
  const { canvasRef, rect, isVisible, reducedMotion } = useCanvasSetup();

  const slicesRef = useRef(slices);
  slicesRef.current = slices;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const timeRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const draw = () => {
      if (!isVisible.current) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const { width, height } = rect.current;
      if (!canvas || !ctx || width === 0 || height === 0) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }

      timeRef.current += reducedMotion ? 0 : 0.02;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale((width * dpr) / 200, (height * dpr) / 200);

      const currentSlices = slicesRef.current;
      const currentActive = activeIndexRef.current;
      const total = currentSlices.reduce((sum, s) => sum + s.value, 0);

      if (total > 0) {
        let startAngle = -Math.PI / 2;
        const gap = currentSlices.length > 1 ? 0.035 : 0;
        currentSlices.forEach((slice, index) => {
          const sweep = (slice.value / total) * Math.PI * 2;
          const start = startAngle + gap;
          const end = Math.max(start, startAngle + sweep - gap);
          const hovered = currentActive === index;

          ctx.save();
          if (hovered) {
            const middle = (start + end) / 2;
            ctx.translate(Math.cos(middle) * 6, Math.sin(middle) * 6);
          }
          ctx.beginPath();
          roundedWedge(ctx, 55, 86, start, end);
          ctx.clip();
          ctx.globalAlpha = hovered ? 1 : currentActive === null ? 0.9 : 0.28;
          ctx.fillStyle = slice.color;
          if (hovered) {
            ctx.shadowColor = rgba(slice.color, 0.55);
            ctx.shadowBlur = 5;
          }

          const cell = 4.6;
          for (let x = 14; x <= 186; x += cell) {
            for (let y = 14; y <= 186; y += cell) {
              const dx = x - 100;
              const dy = y - 100;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < 55 - cell || distance > 86 + cell) continue;
              let angle = Math.atan2(dy, dx) - start;
              while (angle < 0) angle += Math.PI * 2;
              while (angle >= Math.PI * 2) angle -= Math.PI * 2;
              if (angle > end - start) continue;

              const fullness = smoothstep(0.62, 1, (distance - 55) / 31);
              // คลื่นนี้ผูกกับมุม (atan2*3) บวกเวลา ทำให้ลายจุดวิ่งวนรอบวงเองต่อเนื่องตลอด ไม่ใช่แค่
              // เข้ม/จางนิ่ง ๆ ตามตำแหน่ง — คือ "เอฟเฟกต์วูบวาบเวียนรอบวง" ที่ผู้ว่าจ้างขอ
              const waveRaw = reducedMotion
                ? 0
                : Math.sin(distance * 0.1 - timeRef.current) +
                  Math.sin(Math.atan2(dy, dx) * 3 + timeRef.current * 1.5) +
                  Math.sin(dx * 0.05 + dy * 0.05 + timeRef.current * 2);
              const wave = smoothstep(-1.5, 1.5, waveRaw);
              const squareSize =
                cell *
                ((hovered ? 0.46 : 0.34) + 0.36 * fullness + 0.26 * wave) *
                (0.78 + 0.42 * hash(x, y));
              ctx.fillRect(x - squareSize / 2, y - squareSize / 2, squareSize, squareSize);
            }
          }
          ctx.restore();
          startAngle += sweep;
        });
      }

      ctx.restore();
      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [canvasRef, isVisible, rect, reducedMotion]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    // แปลงพิกัดเมาส์จริงให้เป็นพิกัด virtual 200x200 เดียวกับที่ใช้วาด จะได้เทียบมุม/รัศมีตรงกันเป๊ะ
    const vx = ((e.clientX - r.left) / r.width) * 200;
    const vy = ((e.clientY - r.top) / r.height) * 200;
    const dx = vx - 100;
    const dy = vy - 100;
    const distance = Math.hypot(dx, dy);
    const currentSlices = slicesRef.current;
    const total = currentSlices.reduce((sum, s) => sum + s.value, 0);

    if (distance < 55 || distance > 86 || total === 0) {
      onHoverIndex(null);
      return;
    }

    // มุม 0 = 12 นาฬิกา วนตามเข็มนาฬิกา ตรงกับ startAngle=-π/2 ในลูปวาดด้านบนเป๊ะ
    const angle = normalizeAngle(Math.atan2(dy, dx) + Math.PI / 2);
    const fraction = angle / (Math.PI * 2);

    let acc = 0;
    for (let i = 0; i < currentSlices.length; i++) {
      acc += currentSlices[i].value / total;
      if (fraction < acc) {
        onHoverIndex(i);
        return;
      }
    }
    onHoverIndex(currentSlices.length - 1);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, cursor: "pointer" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHoverIndex(null)}
    />
  );
}
