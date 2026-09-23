import type { CatViseme } from "./catVisemes";

export interface VisemeCue {
  startMs: number;
  endMs: number;
  viseme: CatViseme;
  text?: string;
}

export interface VisemeFrame {
  currentViseme: CatViseme;
  progressWithinCue: number;
  isSpeaking: boolean;
  cue: VisemeCue | null;
}

export function normalizeVisemeTimeline(input: readonly VisemeCue[]): VisemeCue[] {
  const sorted = input
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs)
    .map((cue) => ({ ...cue, startMs: Math.max(0, cue.startMs) }))
    .sort((a, b) => a.startMs - b.startMs);

  const merged: VisemeCue[] = [];
  for (const cue of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.viseme === cue.viseme && cue.startMs <= previous.endMs + 1) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
      previous.text = `${previous.text ?? ""}${cue.text ?? ""}` || undefined;
    } else {
      merged.push({ ...cue });
    }
  }
  return merged;
}

export function getVisemeFrame(
  timeline: readonly VisemeCue[],
  playbackMs: number,
  isPlaying: boolean,
): VisemeFrame {
  if (!isPlaying || playbackMs < 0) {
    return { currentViseme: "idle", progressWithinCue: 0, isSpeaking: false, cue: null };
  }
  const cue = timeline.find(({ startMs, endMs }) => playbackMs >= startMs && playbackMs < endMs) ?? null;
  if (!cue || cue.viseme === "idle") {
    return { currentViseme: "idle", progressWithinCue: 0, isSpeaking: false, cue };
  }
  return {
    currentViseme: cue.viseme,
    progressWithinCue: Math.min(1, Math.max(0, (playbackMs - cue.startMs) / (cue.endMs - cue.startMs))),
    isSpeaking: true,
    cue,
  };
}
