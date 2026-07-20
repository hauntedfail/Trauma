import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import {
  createRepositories,
  type BackupFailsafeAlert,
  type TraumaDatabase,
} from "../db/repositories";
import * as schema from "../db/schema";
import {
  findInconsistentSuccessfulBackupContent,
  formatContentInconsistencyError,
} from "./content-integrity";
import { withBackupFailsafeActionLease } from "./failsafe-action-coordination";
import {
  backupFailsafeAlertGenerationWhere,
  getBackupFailsafeAlertGeneration,
} from "./failsafe-alert-generation";
import { executeBuiltInGit } from "./git-command";

export type BackupFailsafeAlertKind =
  | "backup_path_drift"
  | "backup_content_inconsistent"
  | "backup_repository_missing"
  | "backup_push_failed";

export interface BackupFailsafeAlertDetails {
  id: string;
  kind: BackupFailsafeAlertKind;
  severity: "critical";
  message: string;
  previousProjectPath: string | null;
  previousStorePath: string | null;
  currentProjectPath: string;
  currentStorePath: string;
  gitRemote: string;
  gitRemoteUrl: string | null;
  gitBranch: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  generation: string;
}

export type BackupFailsafeRecoveryAction =
  | "revert"
  | "migrate"
  | "delete-missing-record";

/** Browser-safe projection. Operator paths and diagnostics stay server-side. */
export interface BackupFailsafeAlertView {
  id: string;
  kind: BackupFailsafeAlertKind;
  severity: "critical";
  message: string;
  availableActions: BackupFailsafeRecoveryAction[];
  createdAt: string;
  updatedAt: string;
  generation: string;
}

export type BackupEnvironmentResult =
  | { ok: true; alert?: BackupFailsafeAlertDetails }
  | { ok: false; alert: BackupFailsafeAlertDetails };

export interface EnsureBackupEnvironmentInput {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  now?: () => Date;
}

const STAMP_ID = "default";
const ALERT_ID = "active";

export async function ensureBackupEnvironment(
  input: EnsureBackupEnvironmentInput,
): Promise<BackupEnvironmentResult> {
  return withBackupFailsafeActionLease(input.config.databasePath, () =>
    ensureBackupEnvironmentWithLease(input)
  );
}

async function ensureBackupEnvironmentWithLease(
  input: EnsureBackupEnvironmentInput,
): Promise<BackupEnvironmentResult> {
  if (!input.config.backup.git.enabled) {
    return { ok: true };
  }

  const now = (input.now ?? (() => new Date()))();
  const repositories = createRepositories(input.db);
  const stamp =
    await repositories.backupEnvironment.getBackupEnvironmentStamp();
  const existingAlert =
    await repositories.backupEnvironment.getBackupFailsafeAlert();
  const hasMemoryData = await detectMemoryData(input.config, input.db, stamp);
  const currentGitRemoteUrl = await readGitRemoteUrl(input.config);
  const currentGitBranch = await readGitBranch(input.config.projectPath);
  const pathsMatch =
    stamp !== undefined &&
    stamp.projectPath === input.config.projectPath &&
    stamp.storePath === input.config.storePath;
  const gitIdentityMatches =
    stamp !== undefined &&
    stamp.gitRemote === input.config.backup.git.remote &&
    stamp.gitRemoteUrl === currentGitRemoteUrl &&
    stamp.gitBranch === input.config.backup.git.branch &&
    currentGitBranch === input.config.backup.git.branch;

  if (
    existingAlert?.kind === "backup_push_failed" &&
    (stamp === undefined || !pathsMatch || !gitIdentityMatches)
  ) {
    return { ok: false, alert: toAlertDetails(existingAlert) };
  }

  if (stamp === undefined && hasMemoryData) {
    return createAndReportPathAlert({
      config: input.config,
      db: input.db,
      now,
      previousProjectPath: null,
      previousStorePath: null,
    });
  }

  if (stamp !== undefined && !pathsMatch && hasMemoryData) {
    return createAndReportPathAlert({
      config: input.config,
      db: input.db,
      now,
      previousProjectPath: stamp.projectPath,
      previousStorePath: stamp.storePath,
    });
  }

  if (stamp !== undefined && pathsMatch && !gitIdentityMatches && hasMemoryData) {
    return createAndReportPathAlert({
      config: input.config,
      db: input.db,
      now,
      previousProjectPath: null,
      previousStorePath: null,
    });
  }

  const repositoryRoot = await readGitRepositoryRoot(input.config.projectPath);
  if (!(await isSamePath(repositoryRoot, input.config.projectPath))) {
    if (hasMemoryData) {
      return createAndReportRepositoryAlert({
        config: input.config,
        db: input.db,
        now,
        error:
          repositoryRoot === null
            ? "projectPath is not a git repository"
            : `projectPath resolves to parent git repository ${repositoryRoot}`,
      });
    }

    await bootstrapBackupRepository(input.config);
  }

  const inconsistentContent =
    stamp !== undefined && pathsMatch && gitIdentityMatches && hasMemoryData
      ? await findInconsistentSuccessfulBackupContent(input.config, input.db)
      : null;
  if (inconsistentContent !== null) {
    return createAndReportContentAlert({
      config: input.config,
      db: input.db,
      now,
      error: formatContentInconsistencyError(inconsistentContent),
    });
  }

  await upsertCurrentStamp({ config: input.config, db: input.db, now });

  if (
    existingAlert !== undefined &&
    existingAlert.kind !== "backup_push_failed"
  ) {
    if (await clearAlertGeneration(input.db, existingAlert)) {
      return { ok: true };
    }

    const replacement =
      await repositories.backupEnvironment.getBackupFailsafeAlert();
    if (replacement === undefined) {
      return { ok: true };
    }
    const replacementDetails = toAlertDetails(replacement);
    return replacement.kind === "backup_push_failed"
      ? { ok: true, alert: replacementDetails }
      : { ok: false, alert: replacementDetails };
  }

  return {
    ok: true,
    alert: existingAlert === undefined ? undefined : toAlertDetails(existingAlert),
  };
}

export async function assertBackupEnvironmentReady(
  input: EnsureBackupEnvironmentInput,
): Promise<void> {
  const result = await ensureBackupEnvironment(input);
  if (!result.ok) {
    throw new BackupEnvironmentFailsafeError(
      result.alert.message,
      toPublicAlertView(result.alert),
    );
  }
}

export async function getBackupFailsafeStatus(
  input: EnsureBackupEnvironmentInput,
): Promise<{ alert: BackupFailsafeAlertView | null }> {
  const result = await ensureBackupEnvironment(input);
  return {
    alert: result.alert === undefined ? null : toPublicAlertView(result.alert),
  };
}

export async function assertBackupRepositoryRoot(
  config: ResolvedTraumaConfig,
): Promise<void> {
  const repositoryRoot = await readGitRepositoryRoot(config.projectPath);
  if (!(await isSamePath(repositoryRoot, config.projectPath))) {
    const error =
      repositoryRoot === null
        ? "projectPath is not a git repository"
        : `backup repository root mismatch: expected ${config.projectPath}, got ${repositoryRoot}`;
    await recordBackupRepositoryMissingAlert(config, error);
    throw new BackupEnvironmentFailsafeError(error);
  }
}

export async function hasConfiguredRemote(config: ResolvedTraumaConfig) {
  return (await readGitRemoteUrl(config)) !== null;
}

export async function readCurrentBackupGitIdentity(
  config: ResolvedTraumaConfig,
): Promise<{ branch: string | null; remoteUrl: string | null }> {
  const [branch, remoteUrl] = await Promise.all([
    readGitBranch(config.projectPath),
    readGitRemoteUrl(config),
  ]);
  return { branch, remoteUrl };
}

export async function recordBackupPushFailureAlert(
  config: ResolvedTraumaConfig,
  error: string,
): Promise<void> {
  await withBackupFailsafeActionLease(config.databasePath, () =>
    withBackupConnection(config, async (db) => {
      const now = new Date();
      const remoteUrl = await readGitRemoteUrl(config);
      const repositories = createRepositories(db);
      const alert = await repositories.backupEnvironment
        .upsertBackupFailsafeAlert({
          id: ALERT_ID,
          kind: "backup_push_failed",
          severity: "critical",
          message: "Backup push failed",
          previousProjectPath: null,
          previousStorePath: null,
          currentProjectPath: config.projectPath,
          currentStorePath: config.storePath,
          gitRemote: config.backup.git.remote,
          gitRemoteUrl: remoteUrl,
          gitBranch: config.backup.git.branch,
          error: redactOperationalError(error),
          createdAt: now,
          updatedAt: now,
        });
      console.warn(formatPushFailureWarning(toAlertDetails(alert)));
    })
  );
}

export async function clearBackupPushFailureAlert(
  config: ResolvedTraumaConfig,
): Promise<void> {
  await withBackupFailsafeActionLease(config.databasePath, () =>
    withBackupConnection(config, async (db) => {
      const repositories = createRepositories(db);
      const alert =
        await repositories.backupEnvironment.getBackupFailsafeAlert();
      if (alert?.kind === "backup_push_failed") {
        await clearAlertGeneration(db, alert);
      }
    })
  );
}

async function clearAlertGeneration(
  db: TraumaDatabase,
  expectedAlert: BackupFailsafeAlert,
) {
  const cleared = await db
    .delete(schema.backupFailsafeAlerts)
    .where(backupFailsafeAlertGenerationWhere(expectedAlert))
    .returning({ id: schema.backupFailsafeAlerts.id })
    .get();
  return cleared !== undefined;
}

async function createAndReportPathAlert(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  now: Date;
  previousProjectPath: string | null;
  previousStorePath: string | null;
}): Promise<BackupEnvironmentResult> {
  const repositories = createRepositories(input.db);
  const alert = await repositories.backupEnvironment.upsertBackupFailsafeAlert({
    id: ALERT_ID,
    kind: "backup_path_drift",
    severity: "critical",
    message: "Backup location changed",
    previousProjectPath: input.previousProjectPath,
    previousStorePath: input.previousStorePath,
    currentProjectPath: input.config.projectPath,
    currentStorePath: input.config.storePath,
    gitRemote: input.config.backup.git.remote,
    gitRemoteUrl: await readGitRemoteUrl(input.config),
    gitBranch: input.config.backup.git.branch,
    error: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const view = toAlertDetails(alert);
  console.warn(formatPathDriftWarning(view, input.config.configFilePath));
  return { ok: false, alert: view };
}

async function createAndReportRepositoryAlert(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  now: Date;
  error: string;
}): Promise<BackupEnvironmentResult> {
  const repositories = createRepositories(input.db);
  const alert = await repositories.backupEnvironment.upsertBackupFailsafeAlert({
    id: ALERT_ID,
    kind: "backup_repository_missing",
    severity: "critical",
    message: "Backup repository is not initialized",
    previousProjectPath: null,
    previousStorePath: null,
    currentProjectPath: input.config.projectPath,
    currentStorePath: input.config.storePath,
    gitRemote: input.config.backup.git.remote,
    gitRemoteUrl: await readGitRemoteUrl(input.config),
    gitBranch: input.config.backup.git.branch,
    error: input.error,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const view = toAlertDetails(alert);
  console.warn(formatRepositoryWarning(view, input.config.configFilePath));
  return { ok: false, alert: view };
}

async function createAndReportContentAlert(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  now: Date;
  error: string;
}): Promise<BackupEnvironmentResult> {
  const repositories = createRepositories(input.db);
  const alert = await repositories.backupEnvironment.upsertBackupFailsafeAlert({
    id: ALERT_ID,
    kind: "backup_content_inconsistent",
    severity: "critical",
    message: "Backup content is inconsistent",
    previousProjectPath: null,
    previousStorePath: null,
    currentProjectPath: input.config.projectPath,
    currentStorePath: input.config.storePath,
    gitRemote: input.config.backup.git.remote,
    gitRemoteUrl: await readGitRemoteUrl(input.config),
    gitBranch: input.config.backup.git.branch,
    error: input.error,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const view = toAlertDetails(alert);
  console.warn(formatContentIntegrityWarning(view, input.config.configFilePath));
  return { ok: false, alert: view };
}

async function recordBackupRepositoryMissingAlert(
  config: ResolvedTraumaConfig,
  error: string,
): Promise<void> {
  await withBackupFailsafeActionLease(config.databasePath, () =>
    withBackupConnection(config, async (db) => {
      const result = await createAndReportRepositoryAlert({
        config,
        db,
        now: new Date(),
        error,
      });
      if (result.ok) {
        throw new BackupEnvironmentFailsafeError(error);
      }
    })
  );
}

async function upsertCurrentStamp(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  now: Date;
}) {
  const repositories = createRepositories(input.db);
  const existing =
    await repositories.backupEnvironment.getBackupEnvironmentStamp();
  await repositories.backupEnvironment.upsertBackupEnvironmentStamp({
    id: STAMP_ID,
    projectPath: input.config.projectPath,
    storePath: input.config.storePath,
    gitRemote: input.config.backup.git.remote,
    gitRemoteUrl: await readGitRemoteUrl(input.config),
    gitBranch: input.config.backup.git.branch,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  });
}

async function detectMemoryData(
  config: ResolvedTraumaConfig,
  db: TraumaDatabase,
  stamp: { storePath: string } | undefined,
) {
  const memoryRow = await db
    .select({ id: schema.memories.id })
    .from(schema.memories)
    .limit(1)
    .get();
  if (memoryRow !== undefined) {
    return true;
  }

  if (await hasContentFiles(config.storePath)) {
    return true;
  }

  if (
    stamp !== undefined &&
    stamp.storePath !== config.storePath &&
    (await hasContentFiles(stamp.storePath))
  ) {
    return true;
  }

  return false;
}

async function hasContentFiles(storePath: string): Promise<boolean> {
  const memoriesPath = join(storePath, "memories");
  if (!existsSync(memoriesPath)) {
    return false;
  }

  return findContentFile(memoriesPath);
}

async function findContentFile(directory: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }

  for (const entry of entries) {
    const childPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === "CONTENT.md") {
      return true;
    }
    if (entry.isDirectory() && (await findContentFile(childPath))) {
      return true;
    }
  }

  return false;
}

function isErrorWithCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function bootstrapBackupRepository(config: ResolvedTraumaConfig) {
  await mkdir(config.projectPath, { recursive: true });
  await mkdir(config.storePath, { recursive: true });
  await runGit(config.projectPath, [
    "init",
    `--initial-branch=${config.backup.git.branch}`,
  ]);
}

async function readGitRepositoryRoot(projectPath: string) {
  if (!existsSync(projectPath)) {
    return null;
  }

  try {
    const result = await runGit(projectPath, ["rev-parse", "--show-toplevel"]);
    return resolve(result.stdout.trim());
  } catch {
    return null;
  }
}

async function readGitBranch(projectPath: string) {
  if (!existsSync(projectPath)) {
    return null;
  }

  try {
    const result = await runGit(projectPath, ["symbolic-ref", "--short", "HEAD"]);
    const branch = result.stdout.trim();
    return branch === "" ? null : branch;
  } catch {
    return null;
  }
}

async function isSamePath(left: string | null, right: string) {
  if (left === null) {
    return false;
  }

  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return resolve(left) === resolve(right);
  }
}

function isInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

async function readGitRemoteUrl(config: ResolvedTraumaConfig) {
  if (!existsSync(config.projectPath)) {
    return null;
  }

  try {
    const result = await runGit(config.projectPath, [
      "remote",
      "get-url",
      config.backup.git.remote,
    ]);
    const remoteUrl = result.stdout.trim();
    return remoteUrl === "" ? null : fingerprintGitRemote(remoteUrl);
  } catch {
    return null;
  }
}

async function runGit(cwd: string, args: string[]) {
  const result = await executeBuiltInGit(args, {
    cwd,
    env: createGitCommandEnv(),
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function createGitCommandEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

async function withBackupConnection<T>(
  config: ResolvedTraumaConfig,
  callback: (db: TraumaDatabase) => Promise<T>,
): Promise<T> {
  const connection = initializeDatabase(config);
  try {
    return await callback(connection.db);
  } finally {
    connection.close();
  }
}

export function toAlertDetails(
  alert: BackupFailsafeAlert,
): BackupFailsafeAlertDetails {
  return {
    ...alert,
    kind: alert.kind,
    severity: alert.severity,
    createdAt: formatDateTime(alert.createdAt),
    updatedAt: formatDateTime(alert.updatedAt),
    generation: getBackupFailsafeAlertGeneration(alert),
  };
}

export function toPublicAlertView(
  alert: BackupFailsafeAlertDetails,
): BackupFailsafeAlertView {
  const availableActions: BackupFailsafeRecoveryAction[] = [];
  if (alert.kind === "backup_path_drift") {
    if (
      alert.previousProjectPath !== null &&
      alert.previousStorePath !== null
    ) {
      availableActions.push("revert");
    }
    availableActions.push("migrate");
  } else if (alert.kind === "backup_push_failed") {
    availableActions.push("migrate");
  } else if (isMissingContentAlert(alert)) {
    availableActions.push("delete-missing-record");
  }

  return {
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    message: alert.message,
    availableActions,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
    generation: alert.generation,
  };
}

export function formatPathDriftWarning(
  alert: BackupFailsafeAlertDetails,
  configPath: string,
) {
  return [
    "Backup location changed",
    "",
    "TRAUMA detected that the configured backup paths no longer match the paths that already contain your memory backup data.",
    "",
    `Previous project path: ${alert.previousProjectPath ?? "(none)"}`,
    `Previous store path: ${alert.previousStorePath ?? "(none)"}`,
    `Current project path: ${alert.currentProjectPath}`,
    `Current store path: ${alert.currentStorePath}`,
    "",
    "TRAUMA will not silently write memories into the new backup location until this is resolved.",
    "",
    `mise exec -- bun run scripts/trauma-backup-failsafe.ts revert --config ${configPath}`,
    `mise exec -- bun run scripts/trauma-backup-failsafe.ts migrate --config ${configPath}`,
    "The dry run prints the alert generation required by --apply.",
  ].join("\n");
}

function formatContentIntegrityWarning(
  alert: BackupFailsafeAlertDetails,
  configPath: string,
) {
  const lines = [
    "Backup content is inconsistent",
    "",
    "TRAUMA found memory metadata marked as successfully backed up, but the corresponding content file is missing, outside the configured backup paths, or not tracked by the backup repository.",
    "",
    `Current project path: ${alert.currentProjectPath}`,
    `Current store path: ${alert.currentStorePath}`,
    `Error: ${alert.error ?? "unknown"}`,
    "",
    "TRAUMA will not silently write new memory data until this content mismatch is resolved.",
    "",
    `mise exec -- bun run scripts/trauma-backup-failsafe.ts status --config ${configPath}`,
  ];

  if (isMissingContentAlert(alert)) {
    lines.push(
      `mise exec -- bun run scripts/trauma-backup-failsafe.ts delete-missing-record --config ${configPath}`,
      "The dry run prints the alert generation required by --apply.",
    );
  }

  return lines.join("\n");
}

function isMissingContentAlert(alert: BackupFailsafeAlertDetails) {
  return alert.error?.includes("reason=missing_file") ?? false;
}

function formatRepositoryWarning(
  alert: BackupFailsafeAlertDetails,
  configPath: string,
) {
  return [
    "Backup repository is not initialized",
    "",
    alert.error ?? "projectPath is not a git repository",
    "",
    `Current project path: ${alert.currentProjectPath}`,
    `Current store path: ${alert.currentStorePath}`,
    "",
    `mise exec -- bun run scripts/trauma-backup-failsafe.ts status --config ${configPath}`,
  ].join("\n");
}

function formatPushFailureWarning(alert: BackupFailsafeAlertDetails) {
  return [
    "Backup push failed",
    "",
    "TRAUMA committed the memory backup locally, but pushing to the configured remote failed.",
    "",
    `Remote: ${alert.gitRemote}`,
    `Branch: ${alert.gitBranch}`,
    `Error: ${alert.error ?? "unknown"}`,
    "",
    "Your memory content remains committed locally. Fix the remote repository and retry backup push.",
    "",
    `git -C ${shellQuote(alert.currentProjectPath)} remote get-url ${shellQuote(alert.gitRemote)}`,
    `git -C ${shellQuote(alert.currentProjectPath)} push ${shellQuote(alert.gitRemote)} ${shellQuote(`HEAD:${alert.gitBranch}`)}`,
  ].join("\n");
}

export function fingerprintGitRemote(remoteUrl: string) {
  return `sha256:${createHash("sha256").update(remoteUrl).digest("hex")}`;
}

export function redactOperationalError(error: string) {
  return error
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, "$1[redacted]@")
    .replace(/\b(Bearer\s+)[^\s]+/giu, "$1[redacted]")
    .replace(/\b(token|password|secret|authorization)=([^\s&]+)/giu, "$1=[redacted]")
    .slice(0, 4_096);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function formatDateTime(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

export class BackupEnvironmentFailsafeError extends Error {
  readonly alert?: BackupFailsafeAlertView;

  constructor(message: string, alert?: BackupFailsafeAlertView) {
    super(message);
    this.name = "BackupEnvironmentFailsafeError";
    this.alert = alert;
  }
}
