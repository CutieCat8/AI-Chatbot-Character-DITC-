import { describe, expect, it } from "vitest";
import {
  GREETING_VARIANTS,
  createGreetingRotationState,
  drawNextGreeting,
} from "./greetingRotation";

describe("greeting shuffle bag", () => {
  it("ships all 11 WAV entries with a timeline covering the full file", () => {
    expect(GREETING_VARIANTS).toHaveLength(11);
    expect(new Set(GREETING_VARIANTS.map(({ file }) => file)).size).toBe(11);
    for (const greeting of GREETING_VARIANTS) {
      expect(greeting.file).toMatch(/^greeting-\d{2}\.wav$/);
      expect(greeting.timeline.length).toBeGreaterThan(0);
      expect(greeting.timeline[greeting.timeline.length - 1]?.endMs).toBe(greeting.durationMs);
    }
  });

  it("uses every greeting once before repeating", () => {
    let state = createGreetingRotationState();
    const ids: string[] = [];
    for (let index = 0; index < GREETING_VARIANTS.length; index += 1) {
      const drawn = drawNextGreeting(state, () => 0.25);
      ids.push(drawn.greeting.id);
      state = drawn.state;
    }
    expect(new Set(ids).size).toBe(GREETING_VARIANTS.length);
  });

  it("never repeats the same greeting across a cycle boundary", () => {
    let state = createGreetingRotationState();
    const ids: string[] = [];
    for (let index = 0; index < GREETING_VARIANTS.length * 3; index += 1) {
      const drawn = drawNextGreeting(state, () => 0);
      ids.push(drawn.greeting.id);
      state = drawn.state;
    }
    for (let index = 1; index < ids.length; index += 1) {
      expect(ids[index]).not.toBe(ids[index - 1]);
    }
  });

  it("does not mutate the caller's state", () => {
    const state = { remainingIndices: [2, 1], lastIndex: 0 };
    const snapshot = structuredClone(state);
    drawNextGreeting(state, () => 0.5);
    expect(state).toEqual(snapshot);
  });
});
