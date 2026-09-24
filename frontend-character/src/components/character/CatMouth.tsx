import { memo } from "react";
import type { CatSpeechLanguage, CatViseme } from "../../lib/catVisemes";
import "./CatMouth.css";

interface CatMouthProps {
  viseme: CatViseme;
  isSpeaking: boolean;
  language?: CatSpeechLanguage;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const ASSET_BASE = `${import.meta.env.BASE_URL}cat-mouth`;

/** Renders the untouched 176×156 Figma exports inside the face's SVG coordinate system. */
function CatMouthComponent({
  viseme,
  isSpeaking,
  language = "auto",
  x = 632,
  y = 590,
  width = 176,
  height = 156,
}: CatMouthProps) {
  const displayedViseme: CatViseme = isSpeaking || viseme === "smile" ? viseme : "idle";

  return (
    <g
      className={`cat-mouth ${isSpeaking ? "cat-mouth--speaking" : "cat-mouth--idle"}`}
      data-viseme={displayedViseme}
      data-language={language}
      aria-hidden="true"
    >
      <image
        key={displayedViseme}
        className="cat-mouth__shape"
        href={`${ASSET_BASE}/${displayedViseme}.svg`}
        x={x}
        y={y}
        width={width}
        height={height}
        preserveAspectRatio="xMidYMid meet"
      />
    </g>
  );
}

export const CatMouth = memo(CatMouthComponent);
