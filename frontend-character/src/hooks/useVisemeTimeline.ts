import { useEffect, useState } from "react";
import {
  getVisemeFrame,
  type VisemeCue,
  type VisemeFrame,
} from "../lib/visemeTimeline";

interface UseVisemeTimelineOptions {
  timeline: readonly VisemeCue[];
  audioStartTime: number | null;
  isPlaying: boolean;
  audioContext: AudioContext | null;
}

const IDLE_FRAME: VisemeFrame = {
  currentViseme: "idle",
  progressWithinCue: 0,
  isSpeaking: false,
  cue: null,
};

/** Uses the Web Audio clock as the only lip-sync clock; rAF only repaints the current cue. */
export function useVisemeTimeline({
  timeline,
  audioStartTime,
  isPlaying,
  audioContext,
}: UseVisemeTimelineOptions): VisemeFrame {
  const [frame, setFrame] = useState<VisemeFrame>(IDLE_FRAME);

  useEffect(() => {
    if (!isPlaying || audioStartTime === null || !audioContext || timeline.length === 0) {
      setFrame(IDLE_FRAME);
      return;
    }

    let rafId = 0;
    const update = () => {
      const playbackMs = (audioContext.currentTime - audioStartTime) * 1000;
      setFrame(getVisemeFrame(timeline, playbackMs, audioContext.state === "running" && isPlaying));
      rafId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(rafId);
  }, [audioContext, audioStartTime, isPlaying, timeline]);

  return frame;
}
