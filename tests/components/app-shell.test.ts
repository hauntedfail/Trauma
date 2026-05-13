import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");

describe("refined app shell contract", () => {
  it("uses the refined brand mark and icon system", () => {
    expect(appShellSource).toContain("TraumaMark");
    expect(appShellSource).toContain("TraumaNavIcons");
  });

  it("owns local theme controls without server persistence", () => {
    expect(appShellSource).toContain("themeFromPreference");
    expect(appShellSource).toContain("data-theme");
    expect(appShellSource).toContain("localStorage");
    expect(appShellSource).not.toContain("trauma.config.json");
  });

  it("does not add live links for routes that do not exist yet", () => {
    expect(appShellSource).not.toContain('href="/category"');
    expect(appShellSource).not.toContain('href="/tags"');
    expect(appShellSource).not.toContain('href="/backup"');
    expect(appShellSource).not.toContain('href="/settings"');
  });
});
