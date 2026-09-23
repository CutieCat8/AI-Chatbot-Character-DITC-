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
