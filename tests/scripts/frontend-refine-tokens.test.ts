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

function relativeLuminance(hex: string): number {
  const normalized = hex.replace(/^#/, "");
  if (normalized.length !== 6) {
    throw new Error(`Expected 6-digit hex color, got ${hex}`);
  }
  const channels = [0, 2, 4].map((offset) => {
    const srgb = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
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
      "--color-trauma-flashback-bg: var(--flashback-bg)",
      "--color-trauma-quote-bar: var(--hl-quote-bar)",
      "--color-trauma-link: var(--link)",
      "--color-trauma-link-hover: var(--link-hover)",
    ]) {
      expect(tailwindCss).toContain(token);
    }
  });

  it("uses APCA halation-reduced dark charcoal base, surface, and ink in normal night mode", () => {
    const body = tailwindCss.match(
      /:root,\s*:root\[data-theme="black-dark"\]\s*{(?<body>[^}]*)}/s,
    )?.groups?.body;

    if (body === undefined) {
      throw new Error("Missing black-dark theme block");
    }

    expect(readThemeToken(body, "--bg-base")).toBe("#0c0d0f");
    expect(readThemeToken(body, "--bg-surface")).toBe("#0c0d0f");
    expect(readThemeToken(body, "--fg-1")).toBe("#e4e4e0");
    expect(readThemeToken(body, "--font-serif")).toContain("BIZ UDPMincho");
    expect(contrastRatio(readThemeToken(body, "--accent"), readThemeToken(body, "--bg-base"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readThemeToken(body, "--accent"), readThemeToken(body, "--bg-elev"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readThemeToken(body, "--accent"), readThemeToken(body, "--bg-tint"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readThemeToken(body, "--accent-ink"), readThemeToken(body, "--accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("exposes all four user-selectable reading font presets", () => {
    for (const preset of ["sans", "serif", "focus", "mono"]) {
      expect(tailwindCss).toContain(`:root[data-reader-font="${preset}"]`);
    }
    expect(tailwindCss).toContain("--font-focus:");
    expect(tailwindCss).toContain("Atkinson Hyperlegible Next Variable");
    expect(tailwindCss).toContain("BIZ UDPGothic");
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

  it("uses brighter reader link colors in both sun themes", () => {
    for (const themeName of ["warm-light", "paper-warm-light"] as const) {
      const theme = themeBlocks.find((item) => item.name === themeName);
      if (theme === undefined) {
        throw new Error(`Missing theme entry ${themeName}`);
      }

      const body = tailwindCss.match(theme.pattern)?.groups?.body;
      if (body === undefined) {
        throw new Error(`Missing theme block ${theme.name}`);
      }

      expect(readThemeToken(body, "--link")).toBe("var(--wine-500)");
      expect(readThemeToken(body, "--link-hover")).toBe("var(--wine-600)");
      expect(readThemeToken(body, "--link")).not.toBe(readThemeToken(body, "--accent"));
    }
  });

  it("defines readable linked-flashback anchor tokens outside normal night mode", () => {
    for (const theme of themeBlocks.filter((item) => item.name !== "black-dark")) {
      const body = tailwindCss.match(theme.pattern)?.groups?.body;

      if (body === undefined) {
        throw new Error(`Missing theme block ${theme.name}`);
      }

      expect(readThemeToken(body, "--anchor-flashback-bg")).not.toBe("#ffe2a8");
      expect(readThemeToken(body, "--anchor-flashback-ink")).not.toBe("#3d2b12");
      expect(readThemeToken(body, "--anchor-flashback-ring")).not.toBe("");
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
      "--leather-grain-overlay",
      "--leather-fiber-overlay",
      "--leather-pore-overlay",
      "--leather-grain-opacity",
      "--leather-grain-blend",
    ]) {
      expect(body).toContain(token);
    }

    expect(tailwindCss).toContain(':root[data-theme="paper-black-dark"] body');
    expect(tailwindCss).toContain(':root[data-theme="paper-black-dark"] body::before');
    expect(tailwindCss).toContain(':root[data-theme="paper-black-dark"] body::after');
    expect(tailwindCss).toContain("var(--leather-pore-overlay)");
    expect(tailwindCss).toContain("var(--leather-fiber-overlay)");
    expect(tailwindCss).toContain("var(--leather-grain-overlay)");
    expect(tailwindCss).toContain("background: none");
    expect(tailwindCss).toContain("filter: none");
    expect(body).not.toContain("--leather-crease-overlay");
    expect(body).not.toContain("--leather-texture-radials");
    expect(body).not.toContain("--leather-glow-layer");
    expect(body).not.toContain("--leather-sheen-layer");
    expect(body).not.toContain("stroke='%23090704'");
  });

  it("renders material textures through layered backgrounds without dot grid overlays", () => {
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] .trauma-shell-frame');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body::before');
    expect(tailwindCss).toContain(':root[data-theme^="paper"] body::after');
    expect(tailwindCss).toContain("var(--paper-texture-radials)");
    expect(tailwindCss).toContain('url("data:image/svg+xml;utf8,');
    expect(tailwindCss).toContain("filter: blur(120px)");
    expect(tailwindCss).toContain("mix-blend-mode: var(--paper-grain-blend)");
    expect(tailwindCss).toContain("background-image: none");
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
    ).toBeGreaterThanOrEqual(0.4);
  });

  it("keeps refined typography local without runtime font imports or negative tracking", () => {
    expect(tailwindCss).not.toContain("fonts.googleapis.com");
    expect(tailwindCss).toContain("--font-trauma-sans: var(--font-sans)");
    expect(tailwindCss).toContain("--font-trauma-serif: var(--font-serif)");
    expect(tailwindCss).toContain("letter-spacing: 0");
    expect(tailwindCss).not.toMatch(/letter-spacing:\s*-/);
  });
});
