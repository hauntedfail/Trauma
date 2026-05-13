import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("browser extension build", () => {
  it("emits an injected content-script bundle", () => {
    execFileSync("bun", ["run", "build:extension"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    const distRoot = join(process.cwd(), "extensions/browser/dist");
    expect(existsSync(join(distRoot, "manifest.json"))).toBe(true);
    expect(existsSync(join(distRoot, "popup.js"))).toBe(true);
    expect(existsSync(join(distRoot, "service-worker.js"))).toBe(true);
    expect(existsSync(join(distRoot, "inject.bundle.js"))).toBe(true);

    const injectBundle = readFileSync(
      join(distRoot, "inject.bundle.js"),
      "utf8",
    );
    expect(injectBundle).not.toMatch(/^\s*(import|export)\s/m);
  });
});
