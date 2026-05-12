import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  realpath,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { ResolvedTraumaConfig } from "../config";
import { loadTraumaConfig } from "../config";
import { createRepositories, type TraumaDatabase } from "../db/repositories";
import type { BackupFailsafeAlertView } from "./environment";
import { toAlertView } from "./environment";

export type BackupFailsafeAction = "revert" | "migrate";

export interface BackupFailsafeActionResult {
  ok: true;
  action: BackupFailsafeAction;
  dryRun: boolean;
  summary: string;
  files: readonly string[];
}

const execFileAsync = promisify(execFile);

export async function revertBackupFailsafeConfig(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const repositories = createRepositories(input.db);
  const alert = await requireActiveAlert(input.db);
  if (alert.previousProjectPath === null || alert.previousStorePath === null) {
    throw new BackupFailsafeActionError(
      "cannot revert because the failsafe alert has no previous backup paths",
    );
  }

  const summary = [
    input.apply ? "APPLY: Revert config" : "DRY RUN: Revert config",
    `projectPath: ${input.config.projectPath} -> ${alert.previousProjectPath}`,
    `storePath: ${input.config.storePath} -> ${alert.previousStorePath}`,
  ].join("\n");

  if (!input.apply) {
    return { ok: true, action: "revert", dryRun: true, summary, files: [] };
  }

  await rewriteConfigPaths({
    configPath: input.config.configFilePath,
    projectPath: alert.previousProjectPath,
    storePath: alert.previousStorePath,
  });
  const reloaded = loadTraumaConfig({
    configPath: input.config.configFilePath,
  });
  const stamp =
    await repositories.backupEnvironment.getBackupEnvironmentStamp();
  if (
    stamp !== undefined &&
    reloaded.projectPath === stamp.projectPath &&
    reloaded.storePath === stamp.storePath
  ) {
    await repositories.backupEnvironment.clearBackupFailsafeAlert();
  }

  return { ok: true, action: "revert", dryRun: false, summary, files: [] };
}

export async function migrateBackupFailsafeContent(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const repositories = createRepositories(input.db);
  const alert = await requireActiveAlert(input.db);
  if (alert.previousStorePath === null) {
    throw new BackupFailsafeActionError(
      "cannot migrate because the failsafe alert has no previous store path",
    );
  }

  const files = await listFiles(alert.previousStorePath);
  const relativeFiles = files.map((file) => relative(alert.previousStorePath!, file));
  const conflicts = relativeFiles.filter((file) =>
    existsSync(join(input.config.storePath, file)),
  );
  if (conflicts.length > 0) {
    throw new BackupFailsafeActionError(
      `refusing to overwrite existing backup content: ${conflicts[0]}`,
    );
  }

  const summary = [
    input.apply ? "APPLY: Migrate backup" : "DRY RUN: Migrate backup",
    `from: ${alert.previousStorePath}`,
    `to: ${input.config.storePath}`,
    `files: ${relativeFiles.length}`,
  ].join("\n");

  if (!input.apply) {
    return {
      ok: true,
      action: "migrate",
      dryRun: true,
      summary,
      files: relativeFiles,
    };
  }

  await mkdir(input.config.storePath, { recursive: true });
  for (const file of relativeFiles) {
    const source = join(alert.previousStorePath, file);
    const destination = join(input.config.storePath, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  if (!(await isExactGitRepositoryRoot(input.config.projectPath))) {
    await mkdir(input.config.projectPath, { recursive: true });
    await execFileAsync("git", [
      "init",
      `--initial-branch=${input.config.backup.git.branch}`,
    ], {
      cwd: input.config.projectPath,
      env: createGitCommandEnv(),
    });
  }

  const now = new Date();
  const existing =
    await repositories.backupEnvironment.getBackupEnvironmentStamp();
  await repositories.backupEnvironment.upsertBackupEnvironmentStamp({
    id: "default",
    projectPath: input.config.projectPath,
    storePath: input.config.storePath,
    gitRemote: input.config.backup.git.remote,
    gitRemoteUrl: await readGitRemoteUrl(input.config),
    gitBranch: input.config.backup.git.branch,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  await repositories.backupEnvironment.clearBackupFailsafeAlert();

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    summary,
    files: relativeFiles,
  };
}

export async function readActiveBackupFailsafeAlert(
  db: TraumaDatabase,
): Promise<BackupFailsafeAlertView | null> {
  const alert =
    await createRepositories(db).backupEnvironment.getBackupFailsafeAlert();
  return alert === undefined ? null : toAlertView(alert);
}

async function requireActiveAlert(db: TraumaDatabase) {
  const alert = await readActiveBackupFailsafeAlert(db);
  if (alert === null) {
    throw new BackupFailsafeActionError("no active backup failsafe alert");
  }
  return alert;
}

async function rewriteConfigPaths(input: {
  configPath: string;
  projectPath: string;
  storePath: string;
}) {
  const parsed = JSON.parse(await readFile(input.configPath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new BackupFailsafeActionError("config must be a JSON object");
  }
  parsed.projectPath = input.projectPath;
  parsed.storePath = input.storePath;
  await writeFile(input.configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function listFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(child)));
      continue;
    }
    if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

async function isExactGitRepositoryRoot(projectPath: string) {
  if (!existsSync(projectPath)) {
    return false;
  }
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectPath,
      env: createGitCommandEnv(),
    });
    return await isSamePath(result.stdout.trim(), projectPath);
  } catch {
    return false;
  }
}

async function isSamePath(left: string, right: string) {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return resolve(left) === resolve(right);
  }
}

async function readGitRemoteUrl(config: ResolvedTraumaConfig) {
  if (!existsSync(config.projectPath)) {
    return null;
  }
  try {
    const result = await execFileAsync("git", [
      "remote",
      "get-url",
      config.backup.git.remote,
    ], {
      cwd: config.projectPath,
      env: createGitCommandEnv(),
    });
    const value = result.stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

function createGitCommandEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class BackupFailsafeActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFailsafeActionError";
  }
}
