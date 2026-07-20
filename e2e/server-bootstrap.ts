import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadTraumaConfig, type ResolvedTraumaConfig } from "../src/server/config";
import {
  createFixtureConfig,
  type E2eFixtureLayout,
  resolveE2eFixtureLayout,
} from "../src/server/e2e/fixture-layout";
import { runtimeDatabaseLeaseInputs } from "../src/server/runtime/runtime-database-resources";

/**
 * Create only the files needed for request middleware to acquire the runtime
 * lease. Fixture actions remain responsible for resetting application state.
 */
export function ensureE2eServerBootFixture(root?: string): string {
  const layout = root === undefined
    ? resolveE2eFixtureLayout()
    : resolveE2eFixtureLayout(resolve(root));
  assertSafeFixturePaths(layout);

  const configEntry = readEntry(layout.configFile);
  if (configEntry !== undefined) {
    if (!configEntry.isFile()) {
      throw new Error(`E2E fixture config must be a regular file: ${layout.configFile}`);
    }
    assertFixedFixtureRoots(loadTraumaConfig({ configPath: layout.configFile }), layout);
  }

  // Validation deliberately precedes directory creation. A malformed or stale
  // config must fail before Playwright can start a server or touch fixed roots.
  mkdirSync(layout.storePath, { recursive: true });
  mkdirSync(dirname(layout.databasePath), { recursive: true });
  assertSafeFixturePaths(layout);
  if (configEntry === undefined) {
    writeFileSync(
      layout.configFile,
      `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return layout.configFile;
}

function assertFixedFixtureRoots(
  config: ResolvedTraumaConfig,
  layout: E2eFixtureLayout,
): void {
  for (const [field, actual, expected] of [
    ["databasePath", config.databasePath, layout.databasePath],
    ["projectPath", config.projectPath, layout.projectPath],
    ["storePath", config.storePath, layout.storePath],
  ] as const) {
    if (resolve(actual) !== resolve(expected)) {
      throw new Error(
        `E2E fixture ${field} must resolve to the fixed path ${expected}; ` +
          `received ${actual}`,
      );
    }
  }
}

function assertSafeFixturePaths(layout: E2eFixtureLayout): void {
  const expectedDirectories = new Set([
    dirname(layout.root),
    layout.root,
    layout.projectPath,
    layout.storePath,
    dirname(layout.databasePath),
  ]);
  for (const path of expectedDirectories) {
    const entry = readEntry(path);
    if (entry?.isSymbolicLink()) {
      throw new Error(`E2E fixture path must not be a symbolic link: ${path}`);
    }
    if (entry !== undefined && !entry.isDirectory()) {
      throw new Error(`E2E fixture path must be a directory: ${path}`);
    }
  }

  const configEntry = readEntry(layout.configFile);
  if (configEntry?.isSymbolicLink()) {
    throw new Error(
      `E2E fixture path must not be a symbolic link: ${layout.configFile}`,
    );
  }
  if (configEntry !== undefined && !configEntry.isFile()) {
    throw new Error(
      `E2E fixture path must be a regular file: ${layout.configFile}`,
    );
  }

  for (const { resourcePath } of runtimeDatabaseLeaseInputs(layout.databasePath)) {
    const entry = readEntry(resourcePath);
    if (entry?.isSymbolicLink()) {
      throw new Error(
        `E2E fixture path must not be a symbolic link: ${resourcePath}`,
      );
    }
    if (entry !== undefined && !entry.isFile()) {
      throw new Error(
        `E2E fixture path must be a regular file: ${resourcePath}`,
      );
    }
    if (entry !== undefined && entry.nlink !== 1) {
      throw new Error(
        `E2E fixture database file must not have hardlink aliases: ${resourcePath}`,
      );
    }
  }
}

function readEntry(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return undefined;
    }
    throw new Error(
      `Failed to inspect E2E fixture path ${path}: ${formatUnknownError(error)}`,
    );
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
