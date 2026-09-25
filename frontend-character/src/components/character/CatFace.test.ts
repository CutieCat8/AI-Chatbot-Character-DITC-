import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CatFace from "./CatFace";

describe("CatFace angry speech", () => {
  it("uses the active viseme while keeping the angry face state", () => {
    const markup = renderToStaticMarkup(
      createElement(CatFace, { state: "angry", isSpeaking: true, viseme: "aa" }),
    );

    expect(markup).toContain('aria-label="แมว สถานะ angry"');
    expect(markup).toContain('class="cat-mouth cat-mouth--speaking"');
    expect(markup).toContain('data-viseme="aa"');
  });

  it("keeps the fixed frown and does not render the viseme mouth while silent", () => {
    const markup = renderToStaticMarkup(
      createElement(CatFace, { state: "angry", isSpeaking: false, viseme: "aa" }),
    );

    expect(markup).not.toContain('class="cat-mouth');
  });
});
