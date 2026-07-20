import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageJson {
  devDependencies: Record<string, string>;
  overrides?: Record<string, string>;
  scripts: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const playwrightConfig = readFileSync("playwright.config.ts", "utf8");
const appConfig = readFileSync("app.config.ts", "utf8");
const middleware = readFileSync("src/middleware.ts", "utf8");
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

  it("never reuses an unverified server for destructive browser tests", () => {
    expect(playwrightConfig).toContain("reuseExistingServer: false");
    expect(playwrightConfig).not.toContain("reuseExistingServer: !process.env.CI");
  });

  it("runs trusted-host validation before application routing", () => {
    expect(appConfig).toContain('middleware: "./src/middleware.ts"');
    const requestHandler = middleware.slice(middleware.indexOf("onRequest(event)"));
    expect(requestHandler).toContain("ensureRuntimeProcessLeaseFromLoader");
    expect(requestHandler).toContain("isRuntimeLeaseFixtureBypassAllowed");
    expect(requestHandler.indexOf("isTrustedRequestHost")).toBeLessThan(
      requestHandler.indexOf("ensureRuntimeProcessLeaseFromLoader"),
    );
  });

  it("runs the smoke-check Vinxi child process through Bun runtime", () => {
    expect(devSmokeScript).toContain('"--bun",');
    expect(devSmokeScript).toContain('"x", "vinxi", "dev"');
    expect(devSmokeScript).toContain("TRAUMA_RUNTIME_FIXTURE_CONTEXT");
    expect(devSmokeScript).toContain('TRAUMA_CONFIG_PATH: ""');
  });

  it("rejects legacy custom dev-smoke probe paths", () => {
    const result = spawnSync(process.execPath, ["run", "scripts/dev-smoke.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TRAUMA_DEV_SMOKE_PATH: "/health",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "TRAUMA_DEV_SMOKE_PATH no longer accepts custom paths",
    );
  });

  it("keeps esbuild on each toolchain's compatible release line", () => {
    expect(packageJson.overrides).not.toHaveProperty("esbuild");
    expect(packageJson.scripts.audit).toBe(
      "bun audit --ignore GHSA-67mh-4wv8-2f99 --ignore GHSA-g7r4-m6w7-qqqr",
    );
  });

  it("declares build and test tools that repository code imports directly", () => {
    expect(packageJson.devDependencies).toEqual(
      expect.objectContaining({
        "@babel/core": expect.stringMatching(/\S/),
        "vite-plugin-solid": expect.stringMatching(/\S/),
      }),
    );
  });

  it("isolates Git-backed tests from host-global signing configuration", () => {
    const gitSigning = spawnSync(
      "git",
      ["config", "--global", "--get", "commit.gpgSign"],
      { encoding: "utf8" },
    );

    expect(process.env.GIT_CONFIG_GLOBAL).toBe(
      resolve("tests/fixtures/empty.gitconfig"),
    );
    expect(gitSigning.status).not.toBe(0);
    expect(gitSigning.stdout).toBe("");
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
