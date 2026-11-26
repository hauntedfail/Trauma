import { accessSync, constants } from "node:fs";

import { chromium } from "@playwright/test";

export const PLAYWRIGHT_INSTALL_COMMAND = "bun x playwright install chromium";

export interface PlaywrightBrowserCheckResult {
  readonly ok: boolean;
  readonly executablePath: string;
  readonly message: string;
}

export interface PlaywrightBrowserCheckOptions {
  readonly resolveExecutablePath?: () => string;
  readonly verifyExecutable?: (executablePath: string) => void;
}

function defaultVerifyExecutable(executablePath: string): void {
  accessSync(executablePath, constants.X_OK);
}

export function checkPlaywrightBrowser(
  options: PlaywrightBrowserCheckOptions = {},
): PlaywrightBrowserCheckResult {
  const resolveExecutablePath =
    options.resolveExecutablePath ?? (() => chromium.executablePath());
  const verifyExecutable = options.verifyExecutable ?? defaultVerifyExecutable;

  let executablePath: string;
  try {
    executablePath = resolveExecutablePath();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      executablePath: "",
      message: [
        `Playwright Chromium executable could not be resolved: ${detail}`,
        `Install the required Chromium build with: ${PLAYWRIGHT_INSTALL_COMMAND}`,
      ].join("\n"),
    };
  }

  if (executablePath.trim() === "") {
    return {
      ok: false,
      executablePath: "",
      message: [
        "Playwright Chromium executable path is empty.",
        `Install the required Chromium build with: ${PLAYWRIGHT_INSTALL_COMMAND}`,
      ].join("\n"),
    };
  }

  try {
    verifyExecutable(executablePath);
  } catch {
    return {
      ok: false,
      executablePath,
      message: [
        `Playwright Chromium executable is missing or not executable: ${executablePath}`,
        `Install the required Chromium build with: ${PLAYWRIGHT_INSTALL_COMMAND}`,
      ].join("\n"),
    };
  }

  return {
    ok: true,
    executablePath,
    message: `Playwright Chromium executable ready: ${executablePath}`,
  };
}

if (import.meta.main) {
  const result = checkPlaywrightBrowser();
  if (result.ok) {
    // eslint-disable-next-line no-console
    console.log(result.message);
  } else {
    // eslint-disable-next-line no-console
    console.error(result.message);
    process.exitCode = 1;
  }
}
