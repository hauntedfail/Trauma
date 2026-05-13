import { describe, expect, it } from "vitest";

import { themeFromPreference } from "../../src/components/shell/theme";

describe("shell theme preference", () => {
  it("maps brightness and surface preferences to refined theme names", () => {
    expect(themeFromPreference({ brightness: "sun", surface: "normal" })).toBe(
      "warm-light",
    );
    expect(themeFromPreference({ brightness: "night", surface: "normal" })).toBe(
      "black-dark",
    );
    expect(themeFromPreference({ brightness: "sun", surface: "paper" })).toBe(
      "paper-warm-light",
    );
    expect(themeFromPreference({ brightness: "night", surface: "paper" })).toBe(
      "paper-black-dark",
    );
  });
});
