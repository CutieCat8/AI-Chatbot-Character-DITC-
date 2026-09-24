import {
  poseToTransform,
  type CatViseme,
  type ExtendedVisemePose,
} from "./catVisemes";

const COARTICULATION_WINDOW_MS = 60;

export interface VisemeCue {
  startMs: number;
  endMs: number;
  viseme: CatViseme;
  text?: string;
  pose?: ExtendedVisemePose;
}

export interface VisemeFrame {
  currentViseme: CatViseme;
  progressWithinCue: number;
  isSpeaking: boolean;
  cue: VisemeCue | null;
  poseScaleX: number;
  poseScaleY: number;
}

export function normalizeVisemeTimeline(input: readonly VisemeCue[]): VisemeCue[] {
  const sorted = input
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs)
    .map((cue) => ({ ...cue, startMs: Math.max(0, cue.startMs) }))
    .sort((a, b) => a.startMs - b.startMs);

  const merged: VisemeCue[] = [];
  for (const cue of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous
      && previous.viseme === cue.viseme
      && previous.pose === cue.pose
      && cue.startMs <= previous.endMs + 1
    ) {
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
  const idle = (cue: VisemeCue | null = null): VisemeFrame => ({
    currentViseme: "idle",
    progressWithinCue: 0,
    isSpeaking: false,
    cue,
    poseScaleX: 1,
    poseScaleY: 1,
  });
  if (!isPlaying || playbackMs < 0) return idle();

  const cueIndex = timeline.findIndex(({ startMs, endMs }) => playbackMs >= startMs && playbackMs < endMs);
  const cue = cueIndex >= 0 ? timeline[cueIndex] : null;
  if (!cue || cue.viseme === "idle") return idle(cue);

  const progressWithinCue = Math.min(
    1,
    Math.max(0, (playbackMs - cue.startMs) / (cue.endMs - cue.startMs)),
  );
  const currentTransform = poseToTransform(cue.pose);
  const nextCue = timeline[cueIndex + 1];
  const nextTransform = nextCue ? poseToTransform(nextCue.pose) : currentTransform;
  const transitionStart = Math.max(cue.startMs, cue.endMs - COARTICULATION_WINDOW_MS);
  const blend = nextCue && playbackMs >= transitionStart
    ? Math.min(1, (playbackMs - transitionStart) / Math.max(1, cue.endMs - transitionStart))
    : 0;

  return {
    currentViseme: cue.viseme,
    progressWithinCue,
    isSpeaking: true,
    cue,
    poseScaleX: currentTransform.scaleX + (nextTransform.scaleX - currentTransform.scaleX) * blend,
    poseScaleY: currentTransform.scaleY + (nextTransform.scaleY - currentTransform.scaleY) * blend,
  };
}
