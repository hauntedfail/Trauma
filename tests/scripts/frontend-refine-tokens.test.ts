import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");

describe("front-end refine design tokens", () => {
  it("defines all refined theme selectors", () => {
    for (const theme of [
      "warm-light",
      "black-dark",
      "paper-warm-light",
      "paper-black-dark",
    ]) {
      expect(tailwindCss).toContain(`[data-theme="${theme}"]`);
    }
  });

  it("exposes refined semantic colors through Tailwind variables", () => {
    for (const token of [
      "--color-trauma-bg-base: var(--bg-base)",
      "--color-trauma-bg-elev: var(--bg-elev)",
      "--color-trauma-text-secondary: var(--fg-2)",
      "--color-trauma-accent-ink: var(--accent-ink)",
      "--color-trauma-highlight-bg: var(--hl-bg)",
      "--color-trauma-quote-bar: var(--hl-quote-bar)",
    ]) {
      expect(tailwindCss).toContain(token);
    }
  });

  it("keeps refined typography local without runtime font imports or negative tracking", () => {
    expect(tailwindCss).not.toContain("fonts.googleapis.com");
    expect(tailwindCss).toContain("--font-trauma-sans: var(--font-sans)");
    expect(tailwindCss).toContain("--font-trauma-serif: var(--font-serif)");
    expect(tailwindCss).toContain("letter-spacing: 0");
    expect(tailwindCss).not.toMatch(/letter-spacing:\s*-/);
  });
});
