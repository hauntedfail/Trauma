import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLIENT_OPTIMIZE_DEPS_INCLUDE,
  createTraumaAppConfig,
  resolveViteRouterConfig,
} from "../../app.config";
import {
  BUILD_OUTPUT_DIR_ENV,
  DEFAULT_BUILD_OUTPUT_DIR,
  VERIFY_BUILD_OUTPUT_DIR,
  resolveBuildOutputDir,
  resolveNitroOutputConfig,
} from "../../scripts/build-output-config";
import {
  PLAYWRIGHT_INSTALL_COMMAND,
  checkPlaywrightBrowser,
} from "../../scripts/check-playwright-browser";

interface PackageJson {
  scripts: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync("package.json", "utf8"),
) as PackageJson;
const gitignore = readFileSync(".gitignore", "utf8");

describe("verification build output isolation", () => {
  it("defaults build output to .output when TRAUMA_BUILD_OUTPUT_DIR is unset or blank", () => {
    expect(resolveBuildOutputDir({})).toBe(DEFAULT_BUILD_OUTPUT_DIR);
    expect(resolveBuildOutputDir({ [BUILD_OUTPUT_DIR_ENV]: "   " })).toBe(
      DEFAULT_BUILD_OUTPUT_DIR,
    );
    expect(resolveNitroOutputConfig({})).toEqual({
      dir: ".output",
      serverDir: ".output/server",
      publicDir: ".output/public",
    });
  });

  it("redirects Nitro output directories when TRAUMA_BUILD_OUTPUT_DIR is set", () => {
    expect(
      resolveNitroOutputConfig({
        [BUILD_OUTPUT_DIR_ENV]: `${VERIFY_BUILD_OUTPUT_DIR}/`,
      }),
    ).toEqual({
      dir: ".output-verify",
      serverDir: ".output-verify/server",
      publicDir: ".output-verify/public",
    });
  });

  it.each([".", "./", "..", "../outside", "/"])(
    "rejects unsafe TRAUMA_BUILD_OUTPUT_DIR value %s",
    (unsafeValue) => {
      expect(() =>
        resolveBuildOutputDir({ [BUILD_OUTPUT_DIR_ENV]: unsafeValue }),
      ).toThrow(/Invalid TRAUMA_BUILD_OUTPUT_DIR/);
    },
  );

  it("resolves SolidStart/Vinxi server output to .output by default and .output-verify for verify", () => {
    const defaultApp = createTraumaAppConfig({});
    expect(defaultApp.config.server.output).toEqual({
      dir: ".output",
      serverDir: ".output/server",
      publicDir: ".output/public",
    });

    const verifyApp = createTraumaAppConfig({
      [BUILD_OUTPUT_DIR_ENV]: VERIFY_BUILD_OUTPUT_DIR,
    });
    expect(verifyApp.config.server.output).toEqual({
      dir: ".output-verify",
      serverDir: ".output-verify/server",
      publicDir: ".output-verify/public",
    });
  });

  it("pre-bundles client runtime-discovered CommonJS dependencies for cold-cache dev", () => {
    const clientConfig = resolveViteRouterConfig("client", 24678);
    expect(clientConfig.optimizeDeps?.include).toEqual([
      ...CLIENT_OPTIMIZE_DEPS_INCLUDE,
    ]);
    expect(clientConfig.optimizeDeps?.include).toContain("ipaddr.js");

    const serverConfig = resolveViteRouterConfig("server", 24678);
    const serverFnConfig = resolveViteRouterConfig("server-function", 24678);
    expect(serverConfig).not.toHaveProperty("optimizeDeps");
    expect(serverFnConfig).not.toHaveProperty("optimizeDeps");
  });

  it("wires package.json scripts and .gitignore for isolated verification and full e2e gate", () => {
    expect(packageJson.scripts.build).toBe("vinxi build");
    expect(packageJson.scripts.start).toContain("vinxi start");

    const verifyScript = packageJson.scripts.verify ?? "";
    expect(verifyScript).toContain(
      `${BUILD_OUTPUT_DIR_ENV}=\${${BUILD_OUTPUT_DIR_ENV}:-${VERIFY_BUILD_OUTPUT_DIR}} vinxi build`,
    );
    expect(verifyScript).not.toContain("bun run build");

    const preflightScript = packageJson.scripts["test:e2e:preflight"] ?? "";
    expect(preflightScript).toBe("bun run scripts/check-playwright-browser.ts");

    const verifyFullSteps = (packageJson.scripts["verify:full"] ?? "")
      .split("&&")
      .map((step) => step.trim());
    expect(verifyFullSteps).toEqual([
      "bun run verify",
      "bun run test:e2e:preflight",
      "bun run test:e2e",
    ]);

    expect(gitignore.split(/\r?\n/)).toContain(".output-verify/");
  });
});

describe("Playwright browser preflight", () => {
  it("passes when the Chromium executable is accessible", () => {
    const result = checkPlaywrightBrowser({
      resolveExecutablePath: () => "/fake/chromium",
      verifyExecutable: () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.executablePath).toBe("/fake/chromium");
  });

  it("fails with the install command when the executable is missing or unresolvable", () => {
    const missing = checkPlaywrightBrowser({
      resolveExecutablePath: () => "/nonexistent/chromium",
      verifyExecutable: () => {
        throw new Error("ENOENT");
      },
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain(PLAYWRIGHT_INSTALL_COMMAND);

    const broken = checkPlaywrightBrowser({
      resolveExecutablePath: () => {
        throw new Error("registry unavailable");
      },
    });
    expect(broken.ok).toBe(false);
    expect(broken.message).toContain(PLAYWRIGHT_INSTALL_COMMAND);
  });

  it("exits non-zero with the install command when PLAYWRIGHT_BROWSERS_PATH points at a nonexistent cache", () => {
    const nonexistentCache = join(
      process.env.TMPDIR ?? "/tmp",
      `trauma-missing-pw-cache-${process.pid}-${Date.now()}`,
    );
    const result = spawnSync(
      process.execPath,
      ["run", "scripts/check-playwright-browser.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: nonexistentCache,
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(PLAYWRIGHT_INSTALL_COMMAND);
  });
});
