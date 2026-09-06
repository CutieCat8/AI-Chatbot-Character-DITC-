import { useEffect, useRef, useState } from "react";

/**
 * DITC CAT — face renderer (แปลงจาก CatFace.jsx ที่ผู้ใช้เอามาจาก Figma export ของ claude.ai)
 * Geometry ดึงตรงจาก Figma page "CAT Face" (13 เฟรม) — ไม่แตะตัวเลข path ใด ๆ จากต้นฉบับ
 * Coordinate space คือ 1440x900 (Galaxy Tab S10 FE+ @2x)
 *
 * แก้จากต้นฉบับ (README ที่มากับไฟล์อ้างว่า "ใช้ React + Tailwind ที่มีอยู่แล้ว ไม่ต้องลง dependency
 * เพิ่ม" — ผิด โปรเจกต์นี้ไม่มี Tailwind เลย และเป็น .jsx ที่ tsconfig ไม่ได้เปิด allowJs ไว้ ทำให้
 * ไฟล์เดิมหลุดจาก TS program เงียบ ๆ ไม่ error แต่ import จริงไม่ได้) แปลงเป็น .tsx ให้ type-check
 * จริงตามธรรมเนียมโปรเจกต์นี้ (strict: true ทั้งโปรเจกต์)
 */

const INK = "white";
const BG = "#0A0E14";

/* ------------------------------------------------------------------ parts */

const BROWS = {
  normal: (
    <>
      <path d="M633 235H567C558.716 235 552 241.716 552 250C552 258.284 558.716 265 567 265H633C641.284 265 648 258.284 648 250C648 241.716 641.284 235 633 235Z" fill={INK} />
      <path d="M873 235H807C798.716 235 792 241.716 792 250C792 258.284 798.716 265 807 265H873C881.284 265 888 258.284 888 250C888 241.716 881.284 235 873 235Z" fill={INK} />
    </>
  ),
  angry: (
    <>
      <path d="M635.856 244.677L572.413 226.485C564.449 224.202 556.143 228.806 553.859 236.769C551.576 244.733 556.18 253.039 564.144 255.323L627.587 273.515C635.55 275.798 643.857 271.194 646.14 263.231C648.424 255.267 643.819 246.961 635.856 244.677Z" fill={INK} />
      <path d="M867.587 226.485L804.144 244.677C796.18 246.961 791.576 255.267 793.859 263.231C796.143 271.194 804.45 275.798 812.413 273.515L875.856 255.323C883.82 253.039 888.424 244.733 886.141 236.769C883.857 228.806 875.55 224.202 867.587 226.485Z" fill={INK} />
    </>
  ),
};

const EYES = {
  /** 04-idle — thick ring */
  ring: (
    <g fill="none" stroke={INK} strokeWidth="46">
      <path d="M515 602C593.424 602 657 538.424 657 460C657 381.576 593.424 318 515 318C436.576 318 373 381.576 373 460C373 538.424 436.576 602 515 602Z" />
      <path d="M925 602C1003.42 602 1067 538.424 1067 460C1067 381.576 1003.42 318 925 318C846.576 318 783 381.576 783 460C783 538.424 846.576 602 925 602Z" />
    </g>
  ),
  /** 01-sleep — closed bow */
  sleep: (
    <g fill="none" stroke={INK} strokeWidth="46" strokeLinecap="round">
      <path d="M355 430C405 545 625 545 675 430" />
      <path d="M765 430C815 545 1035 545 1085 430" />
    </g>
  ),
  /** 02-wake — > < */
  wake: (
    <g fill="none" stroke={INK} strokeWidth="38" strokeLinecap="round" strokeLinejoin="round">
      <path d="M420 328C510 368 584.333 412 643 460C584.333 508 510 552 420 592" />
      <path d="M1020 328C930 368 855.667 412 797 460C855.667 508 930 552 1020 592" />
    </g>
  ),
  /** 03-angry — sharp outer corner */
  angry: (
    <g fill="none" stroke={INK} strokeWidth="46" strokeLinejoin="bevel">
      <path d="M1069.5 466C1069.5 387.576 1005.92 324 927.5 324C844 413.5 851 406.5 792.5 466C792.5 579 879 608 927.5 608C1005.92 608 1069.5 544.424 1069.5 466Z" />
      <path d="M512 604.5C590.424 604.5 654 540.924 654 462.5C564.5 379 571.5 386 512 327.5C399 327.5 370 414 370 462.5C370 540.924 433.576 604.5 512 604.5Z" />
    </g>
  ),
  /** 06a–06e — filled eye; pupils are a separate group so they can travel */
  gaze: (
    <g fill={INK}>
      <path d="M515 625C606.127 625 680 551.127 680 460C680 368.873 606.127 295 515 295C423.873 295 350 368.873 350 460C350 551.127 423.873 625 515 625Z" />
      <path d="M925 625C1016.13 625 1090 551.127 1090 460C1090 368.873 1016.13 295 925 295C833.873 295 760 368.873 760 460C760 551.127 833.873 625 925 625Z" />
    </g>
  ),
};

/** เก็บไว้ดูอ้างอิง — เฟรม 05a/05b ที่วาดมือ (ยังไม่ได้ใช้จริง ดูคอมเมนต์ที่ CatFaceState.blink) */
export const BLINK_FRAMES = {
  half: (
    <g fill="none" stroke={INK} strokeWidth="46" strokeLinecap="round">
      <path d="M386.3 400C376.211 421.639 371.742 445.473 373.305 469.297C374.867 493.122 382.412 516.167 395.241 536.303C408.07 556.439 425.769 573.016 446.702 584.499C467.634 595.983 491.124 602.003 515 602.003C538.876 602.003 562.366 595.983 583.298 584.499C604.231 573.016 621.93 556.439 634.759 536.303C647.588 516.167 655.133 493.122 656.696 469.297C658.258 445.473 653.789 421.639 643.7 400" />
      <path d="M361 400H669" />
      <path d="M796.3 400C786.211 421.639 781.742 445.473 783.305 469.297C784.867 493.122 792.412 516.167 805.241 536.303C818.07 556.439 835.769 573.016 856.702 584.499C877.634 595.983 901.125 602.003 925 602.003C948.876 602.003 972.366 595.983 993.298 584.499C1014.23 573.016 1031.93 556.439 1044.76 536.303C1057.59 516.167 1065.13 493.122 1066.7 469.297C1068.26 445.473 1063.79 421.639 1053.7 400" />
      <path d="M771 400H1079" />
    </g>
  ),
  closed: (
    <g fill="none" stroke={INK} strokeWidth="54" strokeLinecap="round">
      <path d="M365 460H665" />
      <path d="M775 460H1075" />
    </g>
  ),
};

const PUPILS = (
  <g fill={BG}>
    <circle cx="515" cy="460" r="92" />
    <circle cx="925" cy="460" r="92" />
  </g>
);

const NOSE = <path d="M698 616C706 606 734 606 742 616C734 632 706 632 698 616Z" fill={INK} />;

const MOUTH = {
  neutral: (
    <path d="M686 632C694 668 714 668 720 642C726 668 746 668 754 632" fill="none" stroke={INK} strokeWidth="11" strokeLinecap="round" />
  ),
  open: (
    <g fill="none" stroke={INK} strokeWidth="14" strokeLinecap="round">
      <path d="M682 636C707.333 660 732.667 660 758 636" />
      <path d="M664 660C701.333 692 738.667 692 776 660" />
      <path d="M648 686C696 724.667 744 724.667 792 686" />
    </g>
  ),
  frown: <path d="M768 673L720 646L672 673" fill="none" stroke={INK} strokeWidth="18" />,
};

const EARS = {
  normal: (
    <g fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
      <path d="M446 182.5L392.75 125.75L300 88L307.5 214" strokeWidth="18" />
      <path d="M429.5 165.5L340.876 145.5L326.5 165.5L306 209" strokeWidth="14" />
      <path d="M994 182.5L1047.25 125.75L1140 88L1132.5 214" strokeWidth="18" />
      <path d="M1010.5 165.5L1099.12 145.5L1113.5 165.5L1134 209" strokeWidth="14" />
    </g>
  ),
  /** 07 — หูซ้ายพับตอนฟัง หูขวาใช้ชุดเดียวกับเฟรมอื่น (ดูหมายเหตุในคอมเมนต์ต้นไฟล์เดิม) */
  folded: (
    <g fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
      <path d="M446 182.5L392.75 125.75L300 88L307.5 214" strokeWidth="18" />
      <path d="M429.5 165.5L340.876 145.5L326.5 165.5L306 209" strokeWidth="14" />
      <path d="M959 157.5L1031 112L1113 112V161" strokeWidth="18" />
      <path d="M1029 117L1073.5 218.5L1113.5 161.5V112.5" strokeWidth="18" />
    </g>
  ),
};

const WHISKERS = (
  <g fill="none" stroke={INK} strokeWidth="20" strokeLinecap="round">
    <path d="M240 598L300 598" />
    <path d="M1200 598H1140" />
    <path d="M240 661L300 641" />
    <path d="M1200 661L1140 641" />
  </g>
);

const ZZZ = (
  <g fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round">
    <path d="M1120 310H1152.4L1120 346H1152.4" strokeWidth="7" />
    <path d="M1190 245H1233.2L1190 293H1233.2" strokeWidth="10" />
    <path d="M1280 190H1334L1280 250H1334" strokeWidth="12" />
  </g>
);

const ANGER_MARK = (
  <g fill="none" stroke={INK} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1242.02 250L1273 276.838L1303.97 250" />
    <path d="M1332 276.838L1303.98 306.5L1332 336.163" />
    <path d="M1303.97 363L1273 336.162L1242.02 363" />
    <path d="M1214 336.163L1242.03 306.5L1214 276.838" />
  </g>
);

/* ------------------------------------------------------------------ states */

type EyeKey = keyof typeof EYES;
type MouthKey = keyof typeof MOUTH;
type BrowKey = keyof typeof BROWS;
type EarKey = keyof typeof EARS;

export type CatFaceState = "sleeping" | "waking" | "listening" | "thinking" | "speaking" | "idle" | "angry";

export const CAT_FACE_STATES: readonly CatFaceState[] = [
  "sleeping", "waking", "listening", "thinking", "speaking", "idle", "angry",
];

interface StateConfig {
  eyes: EyeKey;
  mouth: MouthKey;
  brows: BrowKey;
  ears: EarKey;
  zzz?: boolean;
  anger?: boolean;
}

export const STATES: Record<CatFaceState, StateConfig> = {
  sleeping:  { eyes: "sleep", mouth: "neutral", brows: "normal", ears: "normal", zzz: true },
  waking:    { eyes: "wake",  mouth: "open",    brows: "normal", ears: "normal" },
  listening: { eyes: "gaze",  mouth: "neutral", brows: "normal", ears: "folded" },
  thinking:  { eyes: "ring",  mouth: "neutral", brows: "normal", ears: "normal" },
  idle:      { eyes: "ring",  mouth: "neutral", brows: "normal", ears: "normal" },
  speaking:  { eyes: "ring",  mouth: "neutral", brows: "normal", ears: "normal" },
  angry:     { eyes: "angry", mouth: "frown",   brows: "angry",  ears: "normal", anger: true },
};

/* --------------------------------------------------------------- component */

interface CatFaceProps {
  state?: CatFaceState;
  /** ตำแหน่งรูม่านตา [x, y] มีผลเฉพาะตอน state ที่ตาเป็นแบบ gaze (listening) */
  gaze?: readonly [number, number];
  blink?: boolean;
  /**
   * 0-1 จาก amplitude เสียงตอบ — ต้นฉบับ Figma export ยังไม่มี prop นี้ (มีแค่ mouth ทรงเดียว "ω")
   * เพิ่มเข้ามาเพื่อให้ปากขยับตามเสียงตอนพูดจริง (ฟีเจอร์ lip-flap เดิมที่คอมโพเนนต์แมวตัวก่อน
   * — CatCharacter.tsx — มีอยู่แล้ว ก่อนจะถูกลบทิ้งตอนย้ายมาใช้ CatFace ทั้งแอป 2026-09-07
   * — ถ้าไม่ใส่ตัวนี้ตอนสลับไป "speaking" ปากจะหน้าตาเหมือน "idle" เป๊ะ ไม่ขยับเลย)
   */
  amplitude?: number;
  className?: string;
}

export default function CatFace({
  state = "idle",
  gaze = [0, 0],
  blink = false,
  amplitude = 0,
  className = "",
}: CatFaceProps) {
  const cfg = STATES[state] ?? STATES.idle;
  const showPupils = cfg.eyes === "gaze";
  // ปากอ้าตาม amplitude เฉพาะตอน speaking (ตอนอื่นทรงปากคุมด้วย state ล้วน ๆ ตามดีไซน์เดิม)
  const mouthOpenBlend = state === "speaking" ? Math.min(1, Math.max(0, amplitude)) : 0;

  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
      role="img"
      aria-label={`แมว สถานะ ${state}`}
    >
      <rect width="1440" height="900" rx="72" fill={BG} />

      <g style={{ opacity: cfg.eyes === "sleep" ? 0.85 : 1, transition: "opacity 200ms" }}>
        {BROWS[cfg.brows]}
      </g>

      {/* ตา + รูม่านตาใช้ transform กลุ่มเดียวกันตอนกระพริบ (เฉพาะ transform/opacity ตามข้อควรระวัง
          บนแท็บเล็ตที่ระบุไว้ในไฟล์เดิม — ห้ามแอนิเมต d/cx/cy ตรง ๆ จะกระตุกบน Galaxy Tab) */}
      <g
        style={{
          transform: `scaleY(${blink ? 0.04 : 1})`,
          transformOrigin: "720px 460px",
          transition: "transform 90ms ease-in-out",
        }}
      >
        {EYES[cfg.eyes]}
        {showPupils && (
          <g
            style={{
              transform: `translate(${gaze[0]}px, ${gaze[1]}px)`,
              transition: "transform 260ms ease-in-out",
            }}
          >
            {PUPILS}
          </g>
        )}
      </g>

      {NOSE}
      {EARS[cfg.ears]}
      {WHISKERS}

      {/* ปากปกติของ state ปัจจุบัน + ปากอ้า (open) ซ้อนไขว้กันด้วย opacity ไล่ตาม amplitude ตอน
          speaking เท่านั้น — state อื่นแสดงแค่ทรงปากของตัวเองเหมือนเดิมทุกประการ */}
      <g style={{ opacity: 1 - mouthOpenBlend }}>{MOUTH[cfg.mouth]}</g>
      {mouthOpenBlend > 0 && <g style={{ opacity: mouthOpenBlend }}>{MOUTH.open}</g>}

      {cfg.zzz && ZZZ}
      {cfg.anger && ANGER_MARK}
    </svg>
  );
}

/* ------------------------------------------------------------------- hooks */

/** กระพริบตาเป็นช่วง ๆ — `rate` ยิ่งน้อยยิ่งกระพริบถี่ */
export function useBlink({ enabled = true, rate = 1 }: { enabled?: boolean; rate?: number } = {}): boolean {
  const [blink, setBlink] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBlink(false);
      return;
    }
    let cancelled = false;
    const schedule = () => {
      const gap = (2500 + Math.random() * 3500) * rate;
      timer.current = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => {
          if (cancelled) return;
          setBlink(false);
          schedule();
        }, 110);
      }, gap);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, rate]);

  return blink;
}

/** ตากลอก 4 มุม วนผ่านจุดกลางเสมอ (ตรงกับเฟรม 06f ต้นฉบับ) */
const GAZE_STOPS: readonly (readonly [number, number])[] = [
  [-38, -42],
  [0, 0],
  [38, -42],
  [0, 0],
  [-38, 42],
  [0, 0],
  [38, 42],
  [0, 0],
];

export function useGazeLoop({ enabled = true, hold = 900 }: { enabled?: boolean; hold?: number } = {}): readonly [number, number] {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setI(0);
      return;
    }
    const id = setInterval(() => setI((n) => (n + 1) % GAZE_STOPS.length), hold);
    return () => clearInterval(id);
  }, [enabled, hold]);

  return enabled ? GAZE_STOPS[i] : [0, 0];
}
