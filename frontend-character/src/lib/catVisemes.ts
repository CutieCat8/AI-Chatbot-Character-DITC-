export const CAT_VISEMES = [
  "idle",
  "smile",
  "aa",
  "ee",
  "oh",
  "mbp",
  "fv",
  "s",
  "r",
  "wo",
] as const;

export type CatViseme = (typeof CAT_VISEMES)[number];
export type CatSpeechLanguage = "th" | "en" | "auto";

export const ENGLISH_PHONEME_TO_VISEME: Readonly<Record<string, CatViseme>> = {
  A: "aa",
  AH: "aa",
  AE: "aa",
  E: "ee",
  I: "ee",
  Y: "ee",
  O: "oh",
  U: "oh",
  M: "mbp",
  B: "mbp",
  P: "mbp",
  F: "fv",
  V: "fv",
  S: "s",
  Z: "s",
  SH: "s",
  CH: "s",
  J: "s",
  R: "r",
  L: "r",
  W: "wo",
  OO: "wo",
};

export const THAI_PHONEME_TO_VISEME: Readonly<Record<string, CatViseme>> = {
  a: "aa",
  aa: "aa",
  ae: "aa",
  i: "ee",
  ii: "ee",
  e: "ee",
  ee: "ee",
  o: "oh",
  oo: "oh",
  aw: "oh",
  oe: "oh",
  m: "mbp",
  b: "mbp",
  p: "mbp",
  ph: "mbp",
  f: "fv",
  s: "s",
  sh: "s",
  ch: "s",
  j: "s",
  r: "r",
  l: "r",
  w: "wo",
  u: "wo",
  uu: "wo",
};

/** Ready for a future TTS phoneme/timestamp adapter. Unknown sounds use the agreed neutral fallback. */
export function phonemeToViseme(phoneme: string, language: Exclude<CatSpeechLanguage, "auto">): CatViseme {
  const normalized = phoneme.trim();
  if (!normalized) return "r";

  const mapping = language === "th" ? THAI_PHONEME_TO_VISEME : ENGLISH_PHONEME_TO_VISEME;
  const key = language === "th" ? normalized.toLowerCase() : normalized.toUpperCase();
  return mapping[key] ?? "r";
}

export const EXTENDED_VISEME_POSES = [
  "sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR",
  "aa", "E", "I", "O", "U",
] as const;

export type ExtendedVisemePose = (typeof EXTENDED_VISEME_POSES)[number];

export interface VisemePoseMetadata {
  viseme: CatViseme;
  openness: number;
  width?: number;
  roundness?: number;
}

/** Amoner Extended Viseme Set used as design metadata only, never as a classifier. */
export const VISEME_POSE_METADATA: Readonly<Record<ExtendedVisemePose, VisemePoseMetadata>> = {
  sil: { viseme: "idle", openness: 0, width: 0.5 },
  PP: { viseme: "mbp", openness: 0, width: 0.4 },
  FF: { viseme: "fv", openness: 0.05, width: 0.55 },
  TH: { viseme: "s", openness: 0.1, width: 0.5 },
  DD: { viseme: "s", openness: 0.2, width: 0.5 },
  kk: { viseme: "s", openness: 0.25, width: 0.45 },
  CH: { viseme: "s", openness: 0.15, roundness: 0.6 },
  SS: { viseme: "s", openness: 0.05, width: 0.6 },
  nn: { viseme: "s", openness: 0.15, width: 0.5 },
  RR: { viseme: "r", openness: 0.2, roundness: 0.4 },
  aa: { viseme: "aa", openness: 0.9, width: 0.6 },
  E: { viseme: "ee", openness: 0.5, width: 0.65 },
  I: { viseme: "ee", openness: 0.25, width: 0.7 },
  O: { viseme: "oh", openness: 0.6, roundness: 0.8 },
  U: { viseme: "wo", openness: 0.2, roundness: 0.9 },
};

export interface MouthPoseTransform {
  scaleX: number;
  scaleY: number;
}

/**
 * Conservative renderer projection pending A/B calibration with the real SVGs.
 * Missing source dimensions remain neutral instead of being invented.
 */
export function poseToTransform(pose?: ExtendedVisemePose): MouthPoseTransform {
  if (!pose) return { scaleX: 1, scaleY: 1 };
  const metadata = VISEME_POSE_METADATA[pose];
  const widthScale = metadata.width === undefined ? 1 : 1 + (metadata.width - 0.5) * 0.18;
  const roundnessScale = metadata.width === undefined && metadata.roundness !== undefined
    ? 1 - metadata.roundness * 0.02
    : 1;
  return {
    scaleX: widthScale * roundnessScale,
    scaleY: 1 + metadata.openness * 0.08,
  };
}
