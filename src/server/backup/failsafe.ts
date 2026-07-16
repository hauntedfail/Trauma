import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  realpath,
  readFile,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";

import type { ResolvedTraumaConfig } from "../config";
import { loadTraumaConfig } from "../config";
import { createRepositories, type TraumaDatabase } from "../db/repositories";
import * as schema from "../db/schema";
import { writeFileAtomically } from "../files/atomic-write";
import { findInconsistentSuccessfulBackupContent } from "./content-integrity";
import type { BackupFailsafeAlertDetails } from "./environment";
import {
  clearBackupPushFailureAlert,
  ensureBackupEnvironment,
  fingerprintGitRemote,
  hasConfiguredRemote,
  recordBackupPushFailureAlert,
  toAlertDetails,
} from "./environment";

export type BackupFailsafeAction =
  | "revert"
  | "migrate"
  | "delete-missing-record";

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
  if (alert.kind === "backup_push_failed") {
    return retryRecoveredBackupPush({ ...input, repositories });
  }
  if (alert.kind !== "backup_path_drift") {
    throw new BackupFailsafeActionError(
      `cannot accept current backup paths or migrate backup content while ${alert.kind} alert is active`,
    );
  }
  if (alert.previousStorePath === null) {
    return acceptCurrentBackupLocation({ ...input, repositories });
  }

  const files = await listFiles(alert.previousStorePath);
  const relativeFiles = files.map((file) => relative(alert.previousStorePath!, file));
  const conflicts = await findMigrationConflicts({
    sourceStorePath: alert.previousStorePath,
    targetStorePath: input.config.storePath,
    relativeFiles,
  });
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

  await ensureBackupRepository(input.config);
  await commitMigratedFiles(input.config, relativeFiles);
  await stampCurrentBackupLocation(input.config, repositories);
  await pushRecoveredBackup(input.config);
  await repositories.backupEnvironment.clearBackupFailsafeAlert();

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    summary,
    files: relativeFiles,
  };
}

export async function deleteMissingBackupContentRecord(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const alert = await requireActiveAlert(input.db);
  if (alert.kind !== "backup_content_inconsistent") {
    throw new BackupFailsafeActionError(
      `cannot delete missing memory records while ${alert.kind} alert is active`,
    );
  }

  const inconsistentContent = await findInconsistentSuccessfulBackupContent(
    input.config,
    input.db,
  );
  if (inconsistentContent === null) {
    throw new BackupFailsafeActionError(
      "no inconsistent successful backup content was found",
    );
  }
  if (inconsistentContent.reason !== "missing_file") {
    throw new BackupFailsafeActionError(
      `only missing content records can be deleted; current reason is ${inconsistentContent.reason}`,
    );
  }

  const summary = [
    input.apply
      ? "APPLY: Delete missing memory record"
      : "DRY RUN: Delete missing memory record",
    `memoryId: ${inconsistentContent.memoryId}`,
    `contentPath: ${inconsistentContent.contentPath}`,
  ].join("\n");

  if (!input.apply) {
    return {
      ok: true,
      action: "delete-missing-record",
      dryRun: true,
      summary,
      files: [],
    };
  }

  await input.db
    .delete(schema.memories)
    .where(eq(schema.memories.id, inconsistentContent.memoryId))
    .run();
  await createRepositories(input.db).backupEnvironment.clearBackupFailsafeAlert();
  await ensureBackupEnvironment({ config: input.config, db: input.db });

  return {
    ok: true,
    action: "delete-missing-record",
    dryRun: false,
    summary,
    files: [],
  };
}

async function acceptCurrentBackupLocation(input: {
  config: ResolvedTraumaConfig;
  repositories: ReturnType<typeof createRepositories>;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const files = await listFiles(input.config.storePath);
  const relativeFiles = files.map((file) => relative(input.config.storePath, file));
  const summary = [
    input.apply
      ? "APPLY: Accept current backup location"
      : "DRY RUN: Accept current backup location",
    `projectPath: ${input.config.projectPath}`,
    `storePath: ${input.config.storePath}`,
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

  await ensureBackupRepository(input.config);
  await commitMigratedFiles(input.config, relativeFiles);
  await stampCurrentBackupLocation(input.config, input.repositories);
  await pushRecoveredBackup(input.config);
  await input.repositories.backupEnvironment.clearBackupFailsafeAlert();

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    summary,
    files: relativeFiles,
  };
}

async function retryRecoveredBackupPush(input: {
  config: ResolvedTraumaConfig;
  repositories: ReturnType<typeof createRepositories>;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const summary = [
    input.apply ? "APPLY: Retry backup push" : "DRY RUN: Retry backup push",
    `projectPath: ${input.config.projectPath}`,
    `remote: ${input.config.backup.git.remote}`,
    `branch: ${input.config.backup.git.branch}`,
  ].join("\n");

  if (!input.apply) {
    return {
      ok: true,
      action: "migrate",
      dryRun: true,
      summary,
      files: [],
    };
  }

  if (!(await isExactGitRepositoryRoot(input.config.projectPath))) {
    throw new BackupFailsafeActionError(
      "cannot retry backup push because projectPath is not a git repository",
    );
  }

  await pushRecoveredBackup(input.config);
  await input.repositories.backupEnvironment.clearBackupFailsafeAlert();

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    summary,
    files: [],
  };
}

export async function readActiveBackupFailsafeAlert(
  db: TraumaDatabase,
): Promise<BackupFailsafeAlertDetails | null> {
  const alert =
    await createRepositories(db).backupEnvironment.getBackupFailsafeAlert();
  return alert === undefined ? null : toAlertDetails(alert);
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
  await writeFileAtomically(
    input.configPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
}

async function listFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
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

async function findMigrationConflicts(input: {
  sourceStorePath: string;
  targetStorePath: string;
  relativeFiles: readonly string[];
}) {
  const conflicts: string[] = [];
  for (const file of input.relativeFiles) {
    const source = join(input.sourceStorePath, file);
    const target = join(input.targetStorePath, file);
    if (existsSync(target) && !(await hasSameFileContent(source, target))) {
      conflicts.push(file);
    }
  }

  return conflicts;
}

async function hasSameFileContent(left: string, right: string) {
  try {
    const [leftContent, rightContent] = await Promise.all([
      readFile(left),
      readFile(right),
    ]);
    return leftContent.equals(rightContent);
  } catch {
    return false;
  }
}

async function ensureBackupRepository(config: ResolvedTraumaConfig) {
  if (await isExactGitRepositoryRoot(config.projectPath)) {
    return;
  }

  await mkdir(config.projectPath, { recursive: true });
  await execFileAsync("git", [
    "init",
    `--initial-branch=${config.backup.git.branch}`,
  ], {
    cwd: config.projectPath,
    env: createGitCommandEnv(),
  });
}

async function commitMigratedFiles(
  config: ResolvedTraumaConfig,
  relativeFiles: readonly string[],
) {
  if (relativeFiles.length === 0) {
    return;
  }

  const stagePaths = relativeFiles.map((file) =>
    resolveMigratedStagePath(config, file),
  );
  await execFileAsync("git", ["add", "--", ...stagePaths], {
    cwd: config.projectPath,
    env: createGitCommandEnv(),
  });

  const hasStagedChanges = await hasStagedGitChanges(config.projectPath, stagePaths);
  if (!hasStagedChanges) {
    return;
  }

  await execFileAsync(
    "git",
    ["commit", "-m", "backup migrated memory content", "--", ...stagePaths],
    {
      cwd: config.projectPath,
      env: createGitCommandEnv(),
    },
  );
}

async function pushRecoveredBackup(config: ResolvedTraumaConfig) {
  if (!config.backup.git.push || !(await hasConfiguredRemote(config))) {
    return;
  }

  try {
    await execFileAsync("git", [
      "push",
      config.backup.git.remote,
      `HEAD:${config.backup.git.branch}`,
    ], {
      cwd: config.projectPath,
      env: createGitCommandEnv(),
    });
    await clearBackupPushFailureAlert(config);
  } catch (error) {
    const message = formatGitProcessError(error);
    await recordBackupPushFailureAlert(config, message);
    throw new BackupFailsafeActionError(
      "git push failed; see the server diagnostics for details",
    );
  }
}

function resolveMigratedStagePath(config: ResolvedTraumaConfig, file: string) {
  if (isAbsolute(file)) {
    throw new BackupFailsafeActionError(
      `migrated backup file must be relative: ${file}`,
    );
  }

  const absoluteFile = resolve(config.storePath, file);
  if (!isInside(config.storePath, absoluteFile)) {
    throw new BackupFailsafeActionError(
      `migrated backup file must stay under storePath: ${file}`,
    );
  }

  if (!isInside(config.projectPath, absoluteFile)) {
    throw new BackupFailsafeActionError(
      `migrated backup file must stay under projectPath: ${file}`,
    );
  }

  return relative(config.projectPath, absoluteFile).split(sep).join("/");
}

async function hasStagedGitChanges(
  projectPath: string,
  stagePaths: readonly string[],
) {
  try {
    await execFileAsync(
      "git",
      ["diff", "--cached", "--quiet", "--", ...stagePaths],
      {
        cwd: projectPath,
        env: createGitCommandEnv(),
      },
    );
    return false;
  } catch (error) {
    if (isProcessExitCode(error, 1)) {
      return true;
    }

    throw error;
  }
}

async function stampCurrentBackupLocation(
  config: ResolvedTraumaConfig,
  repositories: ReturnType<typeof createRepositories>,
) {
  const now = new Date();
  const existing =
    await repositories.backupEnvironment.getBackupEnvironmentStamp();
  await repositories.backupEnvironment.upsertBackupEnvironmentStamp({
    id: "default",
    projectPath: config.projectPath,
    storePath: config.storePath,
    gitRemote: config.backup.git.remote,
    gitRemoteUrl: await readGitRemoteUrl(config),
    gitBranch: config.backup.git.branch,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

function isErrorWithCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isProcessExitCode(error: unknown, code: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
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
    return value === "" ? null : fingerprintGitRemote(value);
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

function readProcessOutput(
  error: unknown,
  key: "stdout" | "stderr",
): string {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return "";
  }

  const record = error as Partial<Record<"stdout" | "stderr", unknown>>;
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return "";
}

function formatGitProcessError(error: unknown) {
  const stderr = readProcessOutput(error, "stderr").trim();
  if (stderr !== "") {
    return stderr;
  }

  return error instanceof Error ? error.message : String(error);
}

export class BackupFailsafeActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFailsafeActionError";
  }
}
