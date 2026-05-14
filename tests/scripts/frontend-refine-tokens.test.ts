import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const tailwindCss = readFileSync("src/styles/tailwind.css", "utf8");

const themeBlocks = [
  {
    name: "black-dark",
    pattern: /:root,\s*:root\[data-theme="black-dark"\]\s*{(?<body>[^}]*)}/s,
  },
  {
    name: "warm-light",
    pattern: /:root\[data-theme="warm-light"\]\s*{(?<body>[^}]*)}/s,
  },
  {
    name: "paper-warm-light",
    pattern: /:root\[data-theme="paper-warm-light"\]\s*{(?<body>[^}]*)}/s,
  },
  {
    name: "paper-black-dark",
    pattern: /:root\[data-theme="paper-black-dark"\]\s*{(?<body>[^}]*)}/s,
  },
] as const;

function readThemeToken(body: string, tokenName: string): string {
  const match = body.match(new RegExp(`${tokenName}:\\s*([^;]+);`));

  if (match === null || match[1] === undefined) {
    throw new Error(`Missing token ${tokenName}`);
  }

  return match[1].trim();
}

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

  it("sets normal night mode root background to pure black", () => {
    expect(tailwindCss).toMatch(
      /:root,\s*:root\[data-theme="black-dark"\]\s*{[^}]*--bg-base:\s*#000000;/s,
    );
  });

  it("keeps normal night mode pane surfaces pure black", () => {
    expect(tailwindCss).toMatch(
      /:root,\s*:root\[data-theme="black-dark"\]\s*{[^}]*--bg-surface:\s*#000000;/s,
    );
  });

  it("uses one pane background color per theme", () => {
    for (const theme of themeBlocks) {
      const body = tailwindCss.match(theme.pattern)?.groups?.body;

      if (body === undefined) {
        throw new Error(`Missing theme block ${theme.name}`);
      }

      expect(readThemeToken(body, "--bg-surface")).toBe(
        readThemeToken(body, "--bg-base"),
      );
    }
  });

  it("defines paper texture variables for light paper mode", () => {
    const body = tailwindCss.match(
      /:root\[data-theme="paper-warm-light"\]\s*{(?<body>[^}]*)}/s,
    )?.groups?.body;

    if (body === undefined) {
      throw new Error("Missing paper-warm-light theme block");
    }

    for (const token of [
      "--paper-texture-radials",
      "--paper-texture-blend",
      "--paper-grain-opacity",
      "--paper-grain-blend",
      "--paper-glow-opacity",
      "--paper-glow-blend",
      "--paper-glow-layer",
    ]) {
      expect(body).toContain(token);
    }
  });

  it("defines a leather texture recipe for night paper mode", () => {
    const body = tailwindCss.match(
      /:root\[data-theme="paper-black-dark"\]\s*{(?<body>[^}]*)}/s,
    )?.groups?.body;

    if (body === undefined) {
      throw new Error("Missing paper-black-dark theme block");
    }

    for (const token of [
      "--leather-texture-radials",
      "--leather-texture-blend",
      "--leather-grain-overlay",
      "--leather-fiber-overlay",
      "--leather-pore-overlay",
      "--leather-sheen-layer",
      "--leather-grain-opacity",
      "--leather-grain-blend",
      "--leather-glow-opacity",
      "--leather-glow-blend",
      "--leather-glow-layer",
    ]) {
      expect(body).toContain(token);
    }

    expect(tailwindCss).toContain(':root[data-theme="paper-black-dark"] body');
    expect(tailwindCss).toContain(':root[data-theme="paper-black-dark"] body::after');
    expect(tailwindCss).toContain("var(--leather-sheen-layer)");
    expect(tailwindCss).toContain("var(--leather-pore-overlay)");
    expect(tailwindCss).toContain("var(--leather-fiber-overlay)");
    expect(tailwindCss).toContain("var(--leather-grain-overlay)");
    expect(body).not.toContain("--leather-crease-overlay");
    expect(body).not.toContain("stroke='%23090704'");
  });

  it("renders material textures through layered backgrounds without dot grid overlays", () => {
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .bg-trauma-bg-base');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body::before');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body::after');
    expect(tailwindCss).toContain("background-image: var(--paper-texture-radials)");
    expect(tailwindCss).toContain('url("data:image/svg+xml;utf8,');
    expect(tailwindCss).toContain("filter: blur(120px)");
    expect(tailwindCss).toContain("mix-blend-mode: var(--paper-grain-blend)");
    expect(tailwindCss).not.toContain("--paper-dot-grid");
    expect(tailwindCss).not.toContain("--paper-dot-size");
  });

  it("keeps night paper leather grain visibly present", () => {
    const body = tailwindCss.match(
      /:root\[data-theme="paper-black-dark"\]\s*{(?<body>[^}]*)}/s,
    )?.groups?.body;

    if (body === undefined) {
      throw new Error("Missing paper-black-dark theme block");
    }

    expect(
      Number(readThemeToken(body, "--leather-grain-opacity")),
    ).toBeGreaterThanOrEqual(0.62);
  });

  it("keeps refined typography local without runtime font imports or negative tracking", () => {
    expect(tailwindCss).not.toContain("fonts.googleapis.com");
    expect(tailwindCss).toContain("--font-trauma-sans: var(--font-sans)");
    expect(tailwindCss).toContain("--font-trauma-serif: var(--font-serif)");
    expect(tailwindCss).toContain("letter-spacing: 0");
    expect(tailwindCss).not.toMatch(/letter-spacing:\s*-/);
  });
});
