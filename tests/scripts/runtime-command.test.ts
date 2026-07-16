import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface PackageJson {
  overrides?: Record<string, string>;
  scripts: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const playwrightConfig = readFileSync("playwright.config.ts", "utf8");
const devSmokeScript = readFileSync("scripts/dev-smoke.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

describe("runtime command contract", () => {
  it("runs Vinxi server commands through Bun runtime", () => {
    expect(packageJson.scripts.dev).toBe(
      "HOST=${HOST:-127.0.0.1} bun --bun x vinxi dev",
    );
    expect(packageJson.scripts.start).toBe(
      "HOST=${HOST:-127.0.0.1} bun --bun x vinxi start",
    );
    expect(packageJson.scripts.preview).toBe(
      "HOST=${HOST:-127.0.0.1} bun --bun x vinxi preview",
    );
  });

  it("runs Playwright's dev web server through Bun runtime", () => {
    expect(playwrightConfig).toContain("bun --bun x vinxi dev");
    expect(playwrightConfig).toContain("bun --bun .output/server/index.mjs");
  });

  it("runs the smoke-check Vinxi child process through Bun runtime", () => {
    expect(devSmokeScript).toContain('"--bun",');
    expect(devSmokeScript).toContain('"x", "vinxi", "dev"');
  });

  it("keeps esbuild on each toolchain's compatible release line", () => {
    expect(packageJson.overrides).not.toHaveProperty("esbuild");
    expect(packageJson.scripts.audit).toBe(
      "bun audit --ignore GHSA-67mh-4wv8-2f99 --ignore GHSA-g7r4-m6w7-qqqr",
    );
  });

  it("documents operator-facing environment variables in .env.example", () => {
    const expectedKeys = [
      "TRAUMA_BROWSER_IMPORT_ENABLED",
      "TRAUMA_BROWSER_IMPORT_TOKEN",
    ];
    const advancedKeys = [
      "HOST",
      "PORT",
      "TRAUMA_HMR_PORT",
      "TRAUMA_CONFIG_PATH",
      "TRAUMA_DATABASE_PATH",
      "TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS",
      "TRAUMA_BROWSER_IMPORT_MAX_BYTES",
      "TRAUMA_DEV_HOST",
      "TRAUMA_DEV_PORT",
      "TRAUMA_DEV_SMOKE_PATH",
      "TRAUMA_DEV_SMOKE_TIMEOUT_MS",
      "TRAUMA_DEV_SMOKE_POLL_MS",
      "TRAUMA_BROWSE_FIXTURES",
    ];

    for (const key of expectedKeys) {
      expect(envExample).toContain(`${key}=`);
    }

    for (const key of advancedKeys) {
      expect(envExample).not.toContain(`${key}=`);
    }
  });
});
