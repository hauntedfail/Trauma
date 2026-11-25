import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");

describe("app shell right-rail removal", () => {
  it("removes the persistent taxonomy right rail from AppShell", () => {
    expect(appShellSource).not.toContain("RightRailFilters");
    expect(appShellSource).not.toContain("RightRailTaxonomyList");
    expect(appShellSource).not.toContain("trauma-shell-right-rail");
    expect(appShellSource).not.toContain("getBrowseTaxonomy");
  });

  it("removes the obsolete right-rail-context shim", () => {
    expect(existsSync("src/components/shell/right-rail-context.tsx")).toBe(false);
    expect(appShellSource).not.toContain("right-rail-context");
    expect(appShellSource).not.toContain("RightRailContentContext");
  });
});
