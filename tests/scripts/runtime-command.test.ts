import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface PackageJson {
  scripts: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const playwrightConfig = readFileSync("playwright.config.ts", "utf8");
const devSmokeScript = readFileSync("scripts/dev-smoke.ts", "utf8");

describe("runtime command contract", () => {
  it("runs Vinxi server commands through Bun runtime", () => {
    expect(packageJson.scripts.dev).toBe("bun --bun x vinxi dev");
    expect(packageJson.scripts.start).toBe("bun --bun x vinxi start");
    expect(packageJson.scripts.preview).toBe("bun --bun x vinxi preview");
  });

  it("runs Playwright's dev web server through Bun runtime", () => {
    expect(playwrightConfig).toContain("bun --bun x vinxi dev");
    expect(playwrightConfig).toContain("bun --bun .output/server/index.mjs");
  });

  it("runs the smoke-check Vinxi child process through Bun runtime", () => {
    expect(devSmokeScript).toContain('"--bun",');
    expect(devSmokeScript).toContain('"x", "vinxi", "dev"');
  });
});
