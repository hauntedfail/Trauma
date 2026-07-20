import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { TraumaConfigError } from "./errors";
import type {
  ConfigValidationResult,
  LoadTraumaConfigOptions,
  ResolvedTraumaConfig,
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

export function loadRuntimeTraumaConfig(
  options: Omit<LoadTraumaConfigOptions, "configPath"> = {},
): ResolvedTraumaConfig {
  return loadTraumaConfig({
    ...options,
    configPath: process.env.TRAUMA_CONFIG_PATH,
  });
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

  const gitEnabled = isRecord(git)
    ? requireBoolean(git, "enabled", "backup.git.enabled", errors)
    : undefined;
  const gitRemote = isRecord(git)
    ? requireString(git, "remote", "backup.git.remote", errors)
    : undefined;
  const gitBranch = isRecord(git)
    ? requireString(git, "branch", "backup.git.branch", errors)
    : undefined;
  const gitPush = isRecord(git)
    ? requireBoolean(git, "push", "backup.git.push", errors)
    : undefined;
  const gitCommitMessageTemplate = isRecord(git)
    ? requireString(
        git,
        "commitMessageTemplate",
        "backup.git.commitMessageTemplate",
        errors,
      )
    : undefined;

  if (
    errors.length > 0 ||
    storePath === undefined ||
    projectPath === undefined ||
    databasePath === undefined ||
    gitEnabled === undefined ||
    gitRemote === undefined ||
    gitBranch === undefined ||
    gitPush === undefined ||
    gitCommitMessageTemplate === undefined
  ) {
    return { ok: false, errors };
  }

  rejectLiteralTildePath(projectPath, "projectPath", errors);
  rejectLiteralTildePath(storePath, "storePath", errors);
  rejectLiteralTildePath(databasePath, "databasePath", errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const configDir = dirname(resolve(configPath));
  const resolvedConfig: ResolvedTraumaConfig = {
    configFilePath: resolve(configPath),
    projectPath: resolveConfigPath(configDir, projectPath),
    storePath: resolveConfigPath(configDir, storePath),
    databasePath: resolveConfigPath(configDir, databasePath),
    backup: {
      git: {
        enabled: gitEnabled,
        remote: gitRemote,
        branch: gitBranch,
        push: gitPush,
        commitMessageTemplate: gitCommitMessageTemplate,
      },
    },
  };

  const effectiveProjectPath = resolveEffectivePath(
    resolvedConfig.projectPath,
    "projectPath",
    errors,
  );
  const effectiveStorePath = resolveEffectivePath(
    resolvedConfig.storePath,
    "storePath",
    errors,
  );
  const effectiveDatabasePath = resolveEffectivePath(
    resolvedConfig.databasePath,
    "databasePath",
    errors,
  );

  if (
    !isChildPath(resolvedConfig.projectPath, resolvedConfig.storePath) ||
    (effectiveProjectPath !== undefined &&
      effectiveStorePath !== undefined &&
      !isChildPath(effectiveProjectPath, effectiveStorePath))
  ) {
    errors.push("storePath must be inside projectPath");
  }

  if (
    isInsideOrSame(resolvedConfig.storePath, resolvedConfig.databasePath) ||
    (effectiveStorePath !== undefined &&
      effectiveDatabasePath !== undefined &&
      isInsideOrSame(effectiveStorePath, effectiveDatabasePath))
  ) {
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

function resolveEffectivePath(
  path: string,
  label: string,
  errors: string[],
): string | undefined {
  let existingPrefix = path;
  const missingSuffix: string[] = [];

  while (true) {
    try {
      lstatSync(existingPrefix);
    } catch (error) {
      if (!isErrorWithCode(error, "ENOENT")) {
        errors.push(
          `${label} could not be resolved safely: ${formatUnknownError(error)}`,
        );
        return undefined;
      }

      const parent = dirname(existingPrefix);
      if (parent === existingPrefix) {
        errors.push(`${label} could not be resolved safely`);
        return undefined;
      }

      missingSuffix.unshift(basename(existingPrefix));
      existingPrefix = parent;
      continue;
    }

    try {
      return resolve(realpathSync(existingPrefix), ...missingSuffix);
    } catch (error) {
      errors.push(
        `${label} could not be resolved safely: ${formatUnknownError(error)}`,
      );
      return undefined;
    }
  }
}

function rejectLiteralTildePath(
  pathValue: string,
  label: string,
  errors: string[],
) {
  if (pathValue === "~" || pathValue.startsWith("~/")) {
    errors.push(
      `${label} must not start with ~; use an absolute path or a config-relative path`,
    );
  }
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
