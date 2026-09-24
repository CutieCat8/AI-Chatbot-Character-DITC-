import { describe, expect, it } from "vitest";
import {
  CAT_VISEMES,
  phonemeToViseme,
} from "./catVisemes";

describe("cat viseme configuration", () => {
  it("contains all ten Figma mouth states", () => {
    expect(CAT_VISEMES).toEqual(["idle", "smile", "aa", "ee", "oh", "mbp", "fv", "s", "r", "wo"]);
  });

  it("maps representative English and Thai provider phonemes", () => {
    expect(phonemeToViseme("AH", "en")).toBe("aa");
    expect(phonemeToViseme("OO", "en")).toBe("wo");
    expect(phonemeToViseme("ph", "th")).toBe("mbp");
    expect(phonemeToViseme("uu", "th")).toBe("wo");
    expect(phonemeToViseme("unknown", "th")).toBe("r");
  });

});
