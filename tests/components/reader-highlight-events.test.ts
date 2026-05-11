import { describe, expect, it } from "vitest";

import {
  canStartHighlightToggle,
  isExplicitHighlightKeyboardToggle,
} from "../../src/components/reader/highlight-events";

describe("reader highlight keyboard events", () => {
  it("ignores ordinary key releases over selected reader text", () => {
    expect(
      isExplicitHighlightKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: "c",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("allows explicit keyboard highlight activation", () => {
    expect(
      isExplicitHighlightKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("allows explicit keyboard highlight activation with Space", () => {
    expect(
      isExplicitHighlightKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: " ",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("blocks new highlight toggles while any save is pending", () => {
    expect(canStartHighlightToggle("")).toBe(true);
    expect(canStartHighlightToggle("1:2:first")).toBe(false);
  });
});
