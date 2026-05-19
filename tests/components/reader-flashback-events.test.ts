import { describe, expect, it } from "vitest";

import {
  canStartFlashbackToggle,
  isExplicitFlashbackKeyboardToggle,
} from "../../src/components/reader/flashback-events";

describe("reader flashback keyboard events", () => {
  it("ignores ordinary key releases over selected reader text", () => {
    expect(
      isExplicitFlashbackKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: "c",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("allows explicit keyboard flashback activation", () => {
    expect(
      isExplicitFlashbackKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("allows explicit keyboard flashback activation with Space", () => {
    expect(
      isExplicitFlashbackKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: " ",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("blocks new flashback toggles while any save is pending", () => {
    expect(canStartFlashbackToggle("")).toBe(true);
    expect(canStartFlashbackToggle("1:2:first")).toBe(false);
  });
});
