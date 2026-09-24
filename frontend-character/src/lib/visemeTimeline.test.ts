import { describe, expect, it } from "vitest";
import { getVisemeFrame, normalizeVisemeTimeline, type VisemeCue } from "./visemeTimeline";

const timeline: VisemeCue[] = [
  { startMs: 0, endMs: 80, viseme: "mbp", text: "m" },
  { startMs: 80, endMs: 320, viseme: "aa", text: "aaa" },
  { startMs: 320, endMs: 390, viseme: "ee", text: "e" },
];

describe("viseme timeline playback", () => {
  it("changes cues at exact start/end boundaries", () => {
    expect(getVisemeFrame(timeline, 79, true).currentViseme).toBe("mbp");
    expect(getVisemeFrame(timeline, 80, true).currentViseme).toBe("aa");
    expect(getVisemeFrame(timeline, 320, true).currentViseme).toBe("ee");
  });

  it("holds a long vowel for its full cue instead of rotating", () => {
    expect([100, 180, 260, 319].map((ms) => getVisemeFrame(timeline, ms, true).currentViseme))
      .toEqual(["aa", "aa", "aa", "aa"]);
  });

  it("merges adjacent identical cues", () => {
    expect(normalizeVisemeTimeline([
      { startMs: 0, endMs: 100, viseme: "aa" },
      { startMs: 100, endMs: 220, viseme: "aa" },
    ])).toEqual([{ startMs: 0, endMs: 220, viseme: "aa" }]);
  });

  it("returns idle while paused", () => {
    expect(getVisemeFrame(timeline, 120, false).currentViseme).toBe("idle");
  });

  it("shows oh only when the timeline explicitly contains oh", () => {
    expect(timeline.map((_, i) => getVisemeFrame(timeline, [20, 100, 350][i], true).currentViseme))
      .not.toContain("oh");
    expect(getVisemeFrame([{ startMs: 0, endMs: 100, viseme: "oh" }], 50, true).currentViseme).toBe("oh");
  });

  it("cannot change viseme from constant amplitude because amplitude is not an input", () => {
    const constantAmplitudeSamples = Array(20).fill(0.58);
    expect(constantAmplitudeSamples.map(() => getVisemeFrame(timeline, 120, true).currentViseme))
      .toEqual(Array(20).fill("aa"));
  });

  it("returns idle immediately when playback is interrupted", () => {
    expect(getVisemeFrame(timeline, 120, false).isSpeaking).toBe(false);
  });

  it("starts a replacement answer timeline from its own zero", () => {
    const next = [{ startMs: 0, endMs: 200, viseme: "fv" as const }];
    expect(getVisemeFrame(next, 0, true).currentViseme).toBe("fv");
  });
});
