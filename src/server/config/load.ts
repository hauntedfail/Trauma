import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { TraumaConfigError } from "./errors";
import type {
  ConfigValidationResult,
  LoadTraumaConfigOptions,
  ResolvedTraumaConfig,
  TraumaConfig,
} from "./types";

const CONFIG_FILE_NAME = "trauma.config.json";

export function loadTraumaConfig(
  options: LoadTraumaConfigOptions = {},
): ResolvedTraumaConfig {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath
    ? resolveConfigPath(cwd, options.configPath)
    : resolve(cwd, CONFIG_FILE_NAME);

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    const message = isErrorWithCode(error, "ENOENT")
      ? `Missing trauma config at ${configPath}`
      : `Failed to load trauma config at ${configPath}`;

    throw new TraumaConfigError(
      message,
      [`Could not read ${configPath}: ${formatUnknownError(error)}`],
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TraumaConfigError(
      `Invalid JSON in trauma config at ${configPath}`,
      [formatUnknownError(error)],
    );
  }

  const result = validateTraumaConfig(parsed, configPath);
  if (!result.ok) {
    throw new TraumaConfigError(
      `Invalid trauma config at ${configPath}: ${result.errors.join("; ")}`,
      result.errors,
    );
  }

  return result.config;
}

export function validateTraumaConfig(
  value: unknown,
  configPath = resolve(CONFIG_FILE_NAME),
): ConfigValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["config must be a JSON object"] };
  }

  const storePath = requireString(value, "storePath", "storePath", errors);
  const projectPath = requireString(value, "projectPath", "projectPath", errors);
  const databasePath = requireString(
    value,
    "databasePath",
    "databasePath",
    errors,
  );
  const backup = value.backup;

  if (!isRecord(backup)) {
    errors.push("backup must be a JSON object");
  }

  const git = isRecord(backup) ? backup.git : undefined;
  if (!isRecord(git)) {
    errors.push("backup.git must be a JSON object");
  }

  const gitConfig = {
    enabled: isRecord(git)
      ? requireBoolean(git, "enabled", "backup.git.enabled", errors)
      : undefined,
    remote: isRecord(git)
      ? requireString(git, "remote", "backup.git.remote", errors)
      : undefined,
    branch: isRecord(git)
      ? requireString(git, "branch", "backup.git.branch", errors)
      : undefined,
    push: isRecord(git)
      ? requireBoolean(git, "push", "backup.git.push", errors)
      : undefined,
    commitMessageTemplate: isRecord(git)
      ? requireString(
          git,
          "commitMessageTemplate",
          "backup.git.commitMessageTemplate",
          errors,
        )
      : undefined,
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const configDir = dirname(resolve(configPath));
  const resolvedConfig: ResolvedTraumaConfig = {
    configFilePath: resolve(configPath),
    projectPath: resolveConfigPath(configDir, projectPath!),
    storePath: resolveConfigPath(configDir, storePath!),
    databasePath: resolveConfigPath(configDir, databasePath!),
    backup: {
      git: gitConfig as TraumaConfig["backup"]["git"],
    },
  };

  if (!isChildPath(resolvedConfig.projectPath, resolvedConfig.storePath)) {
    errors.push("storePath must be inside projectPath");
  }

  if (isInsideOrSame(resolvedConfig.storePath, resolvedConfig.databasePath)) {
    errors.push("databasePath must be outside storePath");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, config: resolvedConfig };
}

function resolveConfigPath(configDir: string, pathValue: string) {
  return isAbsolute(pathValue) ? resolve(pathValue) : resolve(configDir, pathValue);
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
) {
  const field = readPath(value, key);
  if (typeof field !== "string" || field.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
    return undefined;
  }

  return field;
}

function requireBoolean(
  value: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
) {
  const field = readPath(value, key);
  if (typeof field !== "boolean") {
    errors.push(`${label} must be a boolean`);
    return undefined;
  }

  return field;
}

function readPath(value: Record<string, unknown>, key: string) {
  return key.split(".").reduce<unknown>((current, part) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[part];
  }, value);
}

function isChildPath(parent: string, child: string) {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function isInsideOrSame(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isErrorWithCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
