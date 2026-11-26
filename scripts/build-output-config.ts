import { isAbsolute, normalize, resolve } from "node:path";

export const DEFAULT_BUILD_OUTPUT_DIR = ".output";
export const VERIFY_BUILD_OUTPUT_DIR = ".output-verify";
export const BUILD_OUTPUT_DIR_ENV = "TRAUMA_BUILD_OUTPUT_DIR";

export interface NitroOutputConfig {
  readonly dir: string;
  readonly serverDir: string;
  readonly publicDir: string;
}

export function resolveBuildOutputDir(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const raw = env[BUILD_OUTPUT_DIR_ENV];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_BUILD_OUTPUT_DIR;
  }

  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    throw new Error(
      `Invalid ${BUILD_OUTPUT_DIR_ENV}: ${raw} (must name a dedicated output directory)`,
    );
  }

  if (!isAbsolute(trimmed)) {
    const normalized = normalize(trimmed);
    if (
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(
        `Invalid ${BUILD_OUTPUT_DIR_ENV}: ${raw} (relative paths must stay inside the repository)`,
      );
    }
    return normalized;
  }

  const rootDir = resolve(cwd);
  const resolvedTarget = resolve(trimmed);
  if (resolvedTarget === rootDir || resolvedTarget === "/") {
    throw new Error(
      `Invalid ${BUILD_OUTPUT_DIR_ENV}: ${raw} (cannot target the repository or filesystem root)`,
    );
  }

  return resolvedTarget;
}

export function resolveNitroOutputConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): NitroOutputConfig {
  const dir = resolveBuildOutputDir(env, cwd);
  return {
    dir,
    serverDir: `${dir}/server`,
    publicDir: `${dir}/public`,
  };
}
