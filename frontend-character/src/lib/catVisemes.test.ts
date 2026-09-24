import { describe, expect, it } from "vitest";
import {
  CAT_VISEMES,
  VISEME_POSE_METADATA,
  phonemeToViseme,
  poseToTransform,
} from "./catVisemes";
import { getVisemeFrame, normalizeVisemeTimeline } from "./visemeTimeline";

describe("cat viseme configuration", () => {
  it("contains all ten Figma mouth states", () => {
    expect(CAT_VISEMES).toEqual(["idle", "smile", "aa", "ee", "oh", "mbp", "fv", "s", "r", "wo"]);
  });

  it("keeps the existing provider phoneme mappings", () => {
    expect(phonemeToViseme("AH", "en")).toBe("aa");
    expect(phonemeToViseme("OO", "en")).toBe("wo");
    expect(phonemeToViseme("ph", "th")).toBe("mbp");
    expect(phonemeToViseme("uu", "th")).toBe("wo");
    expect(phonemeToViseme("unknown", "th")).toBe("r");
  });
});

describe("extended viseme pose metadata", () => {
  it("maps design-reference sub-poses to the ten DITC mouth assets", () => {
    expect(VISEME_POSE_METADATA.PP.viseme).toBe("mbp");
    expect(VISEME_POSE_METADATA.FF.viseme).toBe("fv");
    expect(VISEME_POSE_METADATA.O.viseme).toBe("oh");
    expect(VISEME_POSE_METADATA.U.viseme).toBe("wo");
    expect(VISEME_POSE_METADATA.E.viseme).toBe("ee");
    expect(VISEME_POSE_METADATA.I.viseme).toBe("ee");
    expect(Object.values(VISEME_POSE_METADATA).some(({ viseme }) => viseme === "smile")).toBe(false);
  });

  it("keeps mbp closed and does not invent missing source dimensions", () => {
    expect(VISEME_POSE_METADATA.PP.openness).toBe(0);
    expect(VISEME_POSE_METADATA.CH.width).toBeUndefined();
    expect(poseToTransform("PP").scaleY).toBe(1);
  });
});

describe("pose coarticulation", () => {
  it("merges only truly identical adjacent sub-poses", () => {
    const normalized = normalizeVisemeTimeline([
      { startMs: 0, endMs: 100, viseme: "ee", pose: "E" },
      { startMs: 100, endMs: 200, viseme: "ee", pose: "E" },
      { startMs: 200, endMs: 300, viseme: "ee", pose: "I" },
    ]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].endMs).toBe(200);
  });

  it("prepares toward the next pose without inserting a random viseme", () => {
    const timeline = [
      { startMs: 0, endMs: 200, viseme: "aa" as const, pose: "aa" as const },
      { startMs: 200, endMs: 400, viseme: "wo" as const, pose: "U" as const },
    ];
    const early = getVisemeFrame(timeline, 100, true);
    const late = getVisemeFrame(timeline, 190, true);
    expect(early.currentViseme).toBe("aa");
    expect(late.currentViseme).toBe("aa");
    expect(late.poseScaleY).toBeLessThan(early.poseScaleY);
  });
});
