import { execFileSync } from "node:child_process";
import { accessSync } from "node:fs";
import { homedir } from "node:os";

export function runBunFixtureScript(script: string): string {
  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: `${process.cwd()}/.tmp/bun-cache`,
      MISE_TRUSTED_CONFIG_PATHS: `${process.cwd()}/mise.toml`,
      TMPDIR: `${process.cwd()}/.tmp/bun-tmp`,
    },
    stdio: "pipe",
  }).toString("utf8");
}

function resolveBunExecutable(): string {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
    process.versions.bun !== undefined ? process.execPath : undefined,
    `${homedir()}/.local/share/mise/installs/bun/1.3.13/bin/bun`,
    process.env.npm_execpath,
    "bun",
  ];
  const executable = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      isBunExecutable(candidate) &&
      (candidate.includes("/") ? canAccess(candidate) : true),
  );
  if (executable === undefined) {
    throw new Error("Bun executable is required for E2E fixtures");
  }

  return executable;
}

function isBunExecutable(path: string): boolean {
  return path === "bun" || path.endsWith("/bun") || path.endsWith("\\bun.exe");
}

function canAccess(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
