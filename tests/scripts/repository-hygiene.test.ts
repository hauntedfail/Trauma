import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const browseShellSpec = readFileSync("e2e/browse-shell.spec.ts", "utf8");
const readme = readFileSync("README.md", "utf8");

describe("repository hygiene", () => {
  it("waits for observable application state instead of network idle", () => {
    expect(browseShellSpec).not.toContain('waitForLoadState("networkidle")');
  });

  it("keeps the README preview heading and logo markup clean", () => {
    const logo = readme.match(/<img\s+[^>]*Trauma Logo[^>]*\/>/)?.[0];

    expect(logo).toBeDefined();
    expect(logo?.match(/\balt=/g)).toHaveLength(1);
    expect(readme).toContain("## Previews");
    expect(readme).not.toContain("## Proves");
  });
});
