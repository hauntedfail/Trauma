import {
  mkdir,
  lstat,
  realpath,
  readFile,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { eq } from "drizzle-orm";

import type { ResolvedTraumaConfig } from "../config";
import { loadTraumaConfig } from "../config";
import {
  createRepositories,
  type BackupFailsafeAlert,
  type TraumaDatabase,
} from "../db/repositories";
import * as schema from "../db/schema";
import { writeFileAtomically } from "../files/atomic-write";
import { findInconsistentSuccessfulBackupContent } from "./content-integrity";
import type { BackupFailsafeAlertDetails } from "./environment";
import {
  ensureBackupEnvironment,
  hasConfiguredRemote,
  readCurrentBackupGitIdentity,
  recordBackupPushFailureAlert,
  toAlertDetails,
} from "./environment";
import { withBackupFailsafeActionLease } from "./failsafe-action-coordination";
import {
  backupFailsafeAlertGenerationWhere,
  getBackupFailsafeAlertGeneration,
  sameBackupFailsafeAlertGeneration,
} from "./failsafe-alert-generation";
import {
  BackupFailsafeMigrationConflictError,
  copyBackupFailsafeMigrationFile,
} from "./failsafe-migration-file";
import {
  getGitPathspecFileArgs,
  withGitPathspecFile,
} from "./git-pathspec";
import { executeBuiltInGit } from "./git-command";
import { isInternalBackupStorePath } from "../store/internal-directories";
import {
  reserveRuntimeProcessLeaseResourcesIfActive,
  runtimeLeaseInputsForConfig,
  RuntimeStorageBusyError,
  suspendRuntimeStorageAdmissionIfIdle,
} from "../runtime/process-lease";

export type BackupFailsafeAction =
  | "revert"
  | "migrate"
  | "delete-missing-record";

export interface BackupFailsafeActionResult {
  ok: true;
  action: BackupFailsafeAction;
  dryRun: boolean;
  generation: string;
  restartRequired: boolean;
  summary: string;
  files: readonly string[];
}

interface BackupFailsafeActionInput {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  apply: boolean;
  beforeRootChange?: () => void | Promise<void>;
  expectedGeneration?: string;
}

export async function revertBackupFailsafeConfig(
  input: BackupFailsafeActionInput,
): Promise<BackupFailsafeActionResult> {
  return withBackupFailsafeActionLease(input.config.databasePath, async () => {
    const expectedAlert = await requireActiveAlert(input.db);
    if (input.apply) {
      assertApprovedGeneration(expectedAlert, input.expectedGeneration);
      await assertAlertGeneration(input.db, expectedAlert);
    }
    return revertBackupFailsafeConfigForAlert(input, expectedAlert);
  });
}

async function revertBackupFailsafeConfigForAlert(
  input: BackupFailsafeActionInput,
  expectedAlert: BackupFailsafeAlert,
): Promise<BackupFailsafeActionResult> {
  const generation = getBackupFailsafeAlertGeneration(expectedAlert);
  const repositories = createRepositories(input.db);
  const alert = toAlertDetails(expectedAlert);
  assertAlertTargetsCurrentConfig(input.config, expectedAlert);
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
    return {
      ok: true,
      action: "revert",
      dryRun: true,
      generation,
      restartRequired: false,
      summary,
      files: [],
    };
  }

  await assertAlertGeneration(input.db, expectedAlert);
  reservePreviousBackupRoots(input.config, {
    projectPath: alert.previousProjectPath,
    storePath: alert.previousStorePath,
  });
  try {
    await input.beforeRootChange?.();
  } catch {
    throw new BackupFailsafeActionError(
      "TRAUMA could not release current storage activity; recovery did not run.",
    );
  }

  let restartRequired = false;
  try {
    restartRequired = suspendRuntimeStorageAdmissionIfIdle(
      runtimeLeaseInputsForConfig(input.config),
    );
  } catch (error) {
    if (error instanceof RuntimeStorageBusyError) {
      throw error;
    }
    throw new BackupFailsafeRestartRequiredError(
      "TRAUMA could not verify runtime ownership while suspending storage. " +
        "Restart TRAUMA before retrying recovery.",
      error,
    );
  }

  try {
    await rewriteConfigPaths({
      configPath: input.config.configFilePath,
      projectPath: alert.previousProjectPath,
      storePath: alert.previousStorePath,
    });
  } catch (error) {
    if (restartRequired) {
      throw new BackupFailsafeRestartRequiredError(
        "TRAUMA suspended storage but could not rewrite configuration. " +
          "Restart TRAUMA before retrying recovery.",
        error,
      );
    }
    throw error;
  }

  if (!restartRequired && input.beforeRootChange === undefined) {
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
      await clearExpectedAlert(input.db, expectedAlert);
    }
  }

  return {
    ok: true,
    action: "revert",
    dryRun: false,
    generation,
    restartRequired,
    summary,
    files: [],
  };
}

export async function migrateBackupFailsafeContent(
  input: BackupFailsafeActionInput,
): Promise<BackupFailsafeActionResult> {
  return withBackupFailsafeActionLease(input.config.databasePath, async () => {
    const expectedAlert = await requireActiveAlert(input.db);
    if (input.apply) {
      assertApprovedGeneration(expectedAlert, input.expectedGeneration);
      await assertAlertGeneration(input.db, expectedAlert);
    }
    return migrateBackupFailsafeContentForAlert(input, expectedAlert);
  });
}

async function migrateBackupFailsafeContentForAlert(
  input: BackupFailsafeActionInput,
  expectedAlert: BackupFailsafeAlert,
): Promise<BackupFailsafeActionResult> {
  const generation = getBackupFailsafeAlertGeneration(expectedAlert);
  const alert = toAlertDetails(expectedAlert);
  assertAlertTargetsCurrentConfig(input.config, expectedAlert);
  if (alert.kind === "backup_push_failed") {
    return retryRecoveredBackupPush({
      ...input,
      expectedAlert,
    });
  }
  if (alert.kind !== "backup_path_drift") {
    throw new BackupFailsafeActionError(
      `cannot accept current backup paths or migrate backup content while ${alert.kind} alert is active`,
    );
  }
  await assertPathAlertMatchesCurrentConfig(input.config, expectedAlert);
  if (alert.previousStorePath === null) {
    return acceptCurrentBackupLocation({
      ...input,
      expectedAlert,
    });
  }

  reservePreviousBackupRoots(input.config, {
    projectPath: alert.previousProjectPath,
    storePath: alert.previousStorePath,
  });

  await assertDisjointMigrationTopology({
    previousProjectPath: alert.previousProjectPath,
    previousStorePath: alert.previousStorePath,
    currentProjectPath: input.config.projectPath,
    currentStorePath: input.config.storePath,
  });

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
      generation,
      restartRequired: false,
      summary,
      files: relativeFiles,
    };
  }

  await assertAlertGeneration(input.db, expectedAlert);
  for (const file of relativeFiles) {
    const source = join(alert.previousStorePath, file);
    const destination = join(input.config.storePath, file);
    try {
      await copyBackupFailsafeMigrationFile(source, destination, {
        ownerToken: getBackupFailsafeAlertGeneration(expectedAlert),
        targetRoot: input.config.projectPath,
      });
    } catch (error) {
      if (error instanceof BackupFailsafeMigrationConflictError) {
        throw new BackupFailsafeActionError(
          `refusing to overwrite existing backup content: ${file}`,
        );
      }
      throw error;
    }
  }

  await assertAlertGeneration(input.db, expectedAlert);
  await ensureBackupRepository(input.config);
  const identityBeforeCommit = await requireCurrentRecoveryGitState(input.config);
  assertPathAlertApprovesGitState(expectedAlert, identityBeforeCommit);
  const identityAfterCommit = await commitMigratedFiles(
    input.config,
    relativeFiles,
    identityBeforeCommit,
  );
  await pushRecoveredBackup(input.config);
  const identityAfterPush = await requireCurrentRecoveryGitState(input.config);
  assertSameGitState(identityAfterCommit, identityAfterPush);
  await stampCurrentLocationAndClearExpectedAlert({
    config: input.config,
    db: input.db,
    expectedAlert,
    identity: identityAfterPush,
  });

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    generation,
    restartRequired: false,
    summary,
    files: relativeFiles,
  };
}

export async function deleteMissingBackupContentRecord(
  input: BackupFailsafeActionInput,
): Promise<BackupFailsafeActionResult> {
  return withBackupFailsafeActionLease(input.config.databasePath, async () => {
    const expectedAlert = await requireActiveAlert(input.db);
    if (input.apply) {
      assertApprovedGeneration(expectedAlert, input.expectedGeneration);
      await assertAlertGeneration(input.db, expectedAlert);
    }
    return deleteMissingBackupContentRecordForAlert(input, expectedAlert);
  });
}

async function deleteMissingBackupContentRecordForAlert(
  input: BackupFailsafeActionInput,
  expectedAlert: BackupFailsafeAlert,
): Promise<BackupFailsafeActionResult> {
  const generation = getBackupFailsafeAlertGeneration(expectedAlert);
  const alert = toAlertDetails(expectedAlert);
  assertAlertTargetsCurrentConfig(input.config, expectedAlert);
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
      generation,
      restartRequired: false,
      summary,
      files: [],
    };
  }

  await assertAlertGeneration(input.db, expectedAlert);
  deleteMissingRecordAndClearExpectedAlert({
    db: input.db,
    expectedAlert,
    memoryId: inconsistentContent.memoryId,
  });
  await ensureBackupEnvironment({ config: input.config, db: input.db });

  return {
    ok: true,
    action: "delete-missing-record",
    dryRun: false,
    generation,
    restartRequired: false,
    summary,
    files: [],
  };
}

async function acceptCurrentBackupLocation(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  expectedAlert: BackupFailsafeAlert;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const generation = getBackupFailsafeAlertGeneration(input.expectedAlert);
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
      generation,
      restartRequired: false,
      summary,
      files: relativeFiles,
    };
  }

  await assertAlertGeneration(input.db, input.expectedAlert);
  await ensureBackupRepository(input.config);
  const identityBeforeCommit = await requireCurrentRecoveryGitState(input.config);
  assertPathAlertApprovesGitState(input.expectedAlert, identityBeforeCommit);
  const identityAfterCommit = await commitMigratedFiles(
    input.config,
    relativeFiles,
    identityBeforeCommit,
  );
  await pushRecoveredBackup(input.config);
  const identityAfterPush = await requireCurrentRecoveryGitState(input.config);
  assertSameGitState(identityAfterCommit, identityAfterPush);
  await stampCurrentLocationAndClearExpectedAlert({
    config: input.config,
    db: input.db,
    expectedAlert: input.expectedAlert,
    identity: identityAfterPush,
  });

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    generation,
    restartRequired: false,
    summary,
    files: relativeFiles,
  };
}

async function retryRecoveredBackupPush(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  expectedAlert: BackupFailsafeAlert;
  apply: boolean;
}): Promise<BackupFailsafeActionResult> {
  const generation = getBackupFailsafeAlertGeneration(input.expectedAlert);
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
      generation,
      restartRequired: false,
      summary,
      files: [],
    };
  }

  if (!(await isExactGitRepositoryRoot(input.config.projectPath))) {
    throw new BackupFailsafeActionError(
      "cannot retry backup push because projectPath is not a git repository",
    );
  }

  if (
    input.expectedAlert.currentProjectPath !== input.config.projectPath ||
    input.expectedAlert.currentStorePath !== input.config.storePath
  ) {
    throw staleAlertError();
  }

  await assertAlertGeneration(input.db, input.expectedAlert);
  const identityBeforePush = await requireCurrentRecoveryGitState(
    input.config,
  );
  await pushRecoveredBackup(input.config);
  const identityAfterPush = await requireCurrentRecoveryGitState(
    input.config,
  );
  assertSameGitState(identityBeforePush, identityAfterPush);
  await stampCurrentLocationAndClearExpectedAlert({
    config: input.config,
    db: input.db,
    expectedAlert: input.expectedAlert,
    identity: identityAfterPush,
  });

  return {
    ok: true,
    action: "migrate",
    dryRun: false,
    generation,
    restartRequired: false,
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
  const alert =
    await createRepositories(db).backupEnvironment.getBackupFailsafeAlert();
  if (alert === undefined) {
    throw new BackupFailsafeActionError("no active backup failsafe alert");
  }
  return alert;
}

async function assertAlertGeneration(
  db: TraumaDatabase,
  expectedAlert: BackupFailsafeAlert,
) {
  const current =
    await createRepositories(db).backupEnvironment.getBackupFailsafeAlert();
  if (
    current === undefined ||
    !sameBackupFailsafeAlertGeneration(current, expectedAlert)
  ) {
    throw staleAlertError();
  }
}

function assertApprovedGeneration(
  alert: BackupFailsafeAlert,
  expectedGeneration: string | undefined,
) {
  if (
    expectedGeneration === undefined ||
    getBackupFailsafeAlertGeneration(alert) !== expectedGeneration
  ) {
    throw staleAlertError();
  }
}

async function clearExpectedAlert(
  db: TraumaDatabase,
  expectedAlert: BackupFailsafeAlert,
) {
  const result = await db
    .delete(schema.backupFailsafeAlerts)
    .where(backupFailsafeAlertGenerationWhere(expectedAlert))
    .returning({ id: schema.backupFailsafeAlerts.id })
    .get();
  if (result === undefined) {
    throw staleAlertError();
  }
}

function deleteMissingRecordAndClearExpectedAlert(input: {
  db: TraumaDatabase;
  expectedAlert: BackupFailsafeAlert;
  memoryId: string;
}) {
  input.db.transaction((tx) => {
    const deleted = tx
      .delete(schema.memories)
      .where(eq(schema.memories.id, input.memoryId))
      .returning({ id: schema.memories.id })
      .get();
    if (deleted === undefined) {
      throw new BackupFailsafeActionError(
        "the missing memory record changed while recovery was running; refresh and retry",
      );
    }

    const cleared = tx
      .delete(schema.backupFailsafeAlerts)
      .where(backupFailsafeAlertGenerationWhere(input.expectedAlert))
      .returning({ id: schema.backupFailsafeAlerts.id })
      .get();
    if (cleared === undefined) {
      throw staleAlertError();
    }
  });
}

async function stampCurrentLocationAndClearExpectedAlert(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  expectedAlert: BackupFailsafeAlert;
  identity: RecoveryGitState;
}) {
  const now = new Date();
  input.db.transaction((tx) => {
    const existing = tx
      .select()
      .from(schema.backupEnvironmentStamps)
      .where(eq(schema.backupEnvironmentStamps.id, "default"))
      .get();
    tx
      .insert(schema.backupEnvironmentStamps)
      .values({
        id: "default",
        projectPath: input.config.projectPath,
        storePath: input.config.storePath,
        gitRemote: input.config.backup.git.remote,
        gitRemoteUrl: input.identity.remoteUrl,
        gitBranch: input.identity.branch,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.backupEnvironmentStamps.id,
        set: {
          projectPath: input.config.projectPath,
          storePath: input.config.storePath,
          gitRemote: input.config.backup.git.remote,
          gitRemoteUrl: input.identity.remoteUrl,
          gitBranch: input.identity.branch,
          updatedAt: now,
        },
      })
      .run();

    const cleared = tx
      .delete(schema.backupFailsafeAlerts)
      .where(backupFailsafeAlertGenerationWhere(input.expectedAlert))
      .returning({ id: schema.backupFailsafeAlerts.id })
      .get();
    if (cleared === undefined) {
      throw staleAlertError();
    }
  });
}

interface RecoveryGitState {
  repositoryRoot: string;
  branch: string;
  remoteUrl: string | null;
  head: string | null;
}

async function assertPathAlertMatchesCurrentConfig(
  config: ResolvedTraumaConfig,
  alert: BackupFailsafeAlert,
) {
  assertAlertTargetsCurrentConfig(config, alert);
  if (
    alert.gitRemote !== config.backup.git.remote ||
    alert.gitBranch !== config.backup.git.branch
  ) {
    throw staleAlertError();
  }

  if (await isExactGitRepositoryRoot(config.projectPath)) {
    assertPathAlertApprovesGitState(
      alert,
      await requireCurrentRecoveryGitState(config),
    );
  }
}

function assertAlertTargetsCurrentConfig(
  config: ResolvedTraumaConfig,
  alert: BackupFailsafeAlert,
) {
  if (
    alert.currentProjectPath !== config.projectPath ||
    alert.currentStorePath !== config.storePath
  ) {
    throw staleAlertError();
  }
}

function assertPathAlertApprovesGitState(
  alert: BackupFailsafeAlert,
  state: RecoveryGitState,
) {
  if (alert.gitRemoteUrl !== state.remoteUrl) {
    throw staleAlertError();
  }
}

async function requireCurrentRecoveryGitState(
  config: ResolvedTraumaConfig,
): Promise<RecoveryGitState> {
  const rootResult = await executeBuiltInGit(["rev-parse", "--show-toplevel"], {
    cwd: config.projectPath,
    env: createGitCommandEnv(),
  }).catch(() => null);
  if (
    rootResult === null ||
    !(await isSamePath(rootResult.stdout.trim(), config.projectPath))
  ) {
    throw new BackupFailsafeActionError(
      "cannot recover backup because projectPath is not the exact git repository root",
    );
  }
  const identity = await readCurrentBackupGitIdentity(config);
  if (identity.branch !== config.backup.git.branch) {
    throw new BackupFailsafeActionError(
      `cannot retry backup push because checked-out branch ${identity.branch ?? "(detached)"} does not match configured branch ${config.backup.git.branch}`,
    );
  }
  let head: string | null = null;
  try {
    const result = await executeBuiltInGit(["rev-parse", "--verify", "HEAD"], {
      cwd: config.projectPath,
      env: createGitCommandEnv(),
    });
    head = result.stdout.trim() || null;
  } catch {
    // An initialized repository may have an unborn configured branch.
  }
  return {
    repositoryRoot: await realpath(config.projectPath),
    branch: identity.branch,
    remoteUrl: identity.remoteUrl,
    head,
  };
}

function assertSameGitState(left: RecoveryGitState, right: RecoveryGitState) {
  if (
    left.repositoryRoot !== right.repositoryRoot ||
    left.branch !== right.branch ||
    left.remoteUrl !== right.remoteUrl ||
    left.head !== right.head
  ) {
    throw new BackupFailsafeActionError(
      "backup git identity or HEAD changed during recovery; refresh and retry",
    );
  }
}

function staleAlertError() {
  return new BackupFailsafeActionError(
    "backup failsafe alert changed while recovery was running; refresh and retry",
  );
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

function reservePreviousBackupRoots(
  config: ResolvedTraumaConfig,
  previous: { projectPath: string | null; storePath: string },
): void {
  const resources = [
    ...(previous.projectPath === null
      ? []
      : [{ resourceLabel: "previousProjectPath", resourcePath: previous.projectPath }]),
    { resourceLabel: "previousStorePath", resourcePath: previous.storePath },
  ];
  reserveRuntimeProcessLeaseResourcesIfActive(
    runtimeLeaseInputsForConfig(config),
    resources,
  );
}

async function listFiles(
  directory: string,
  relativeDirectory = "",
): Promise<string[]> {
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
    const relativeChild = relativeDirectory === ""
      ? entry.name
      : join(relativeDirectory, entry.name);
    if (
      isInternalBackupStorePath(relativeChild) ||
      relativeChild.split(sep).includes(".git")
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(child, relativeChild)));
      continue;
    }
    if (entry.isFile()) {
      files.push(child);
      continue;
    }
    throw new BackupFailsafeActionError(
      `unsupported backup migration source entry: ${relativeChild}`,
    );
  }
  return files;
}

async function assertDisjointMigrationTopology(input: {
  previousProjectPath: string | null;
  previousStorePath: string;
  currentProjectPath: string;
  currentStorePath: string;
}) {
  const previousPaths = [
    input.previousProjectPath,
    input.previousStorePath,
  ].filter((path): path is string => path !== null);
  const currentPaths = [input.currentProjectPath, input.currentStorePath];
  for (const previousPath of previousPaths) {
    for (const currentPath of currentPaths) {
      if (await pathsOverlap(previousPath, currentPath)) {
        throw new BackupFailsafeActionError(
          "previous and current backup paths overlap; choose disjoint projectPath and storePath locations before migrating",
        );
      }
    }
  }
}

async function pathsOverlap(left: string, right: string) {
  if (
    resolve(left) === resolve(right) ||
    isInside(left, right) ||
    isInside(right, left)
  ) {
    return true;
  }
  const [canonicalLeft, canonicalRight] = await Promise.all([
    canonicalizePossiblyMissingPath(left),
    canonicalizePossiblyMissingPath(right),
  ]);
  return (
    canonicalLeft === canonicalRight ||
    isInside(canonicalLeft, canonicalRight) ||
    isInside(canonicalRight, canonicalLeft)
  );
}

async function canonicalizePossiblyMissingPath(path: string) {
  let existingAncestor = resolve(path);
  const missingComponents: string[] = [];
  for (;;) {
    try {
      return resolve(
        await realpath(existingAncestor),
        ...missingComponents,
      );
    } catch (error) {
      if (!isErrorWithCode(error, "ENOENT")) {
        throw error;
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw error;
      }
      missingComponents.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
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
    if (!(await lstat(right)).isFile()) {
      return false;
    }
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
  await executeBuiltInGit([
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
  expectedState: RecoveryGitState,
): Promise<RecoveryGitState> {
  if (relativeFiles.length === 0) {
    const currentState = await requireCurrentRecoveryGitState(config);
    assertSameGitState(expectedState, currentState);
    return currentState;
  }

  const stagePaths = relativeFiles.map((file) =>
    resolveMigratedStagePath(config, file),
  );
  await withGitPathspecFile(stagePaths, async (pathspecFile) => {
    assertSameGitState(
      expectedState,
      await requireCurrentRecoveryGitState(config),
    );
    const pathspecArgs = getGitPathspecFileArgs(pathspecFile);
    await executeBuiltInGit(["add", ...pathspecArgs], {
      cwd: config.projectPath,
      env: createGitCommandEnv(),
    });
    assertSameGitState(
      expectedState,
      await requireCurrentRecoveryGitState(config),
    );

    const hasStagedChanges = await hasStagedGitChanges(
      config.projectPath,
      stagePaths,
    );
    if (!hasStagedChanges) {
      return;
    }

    await executeBuiltInGit(
      [
        "commit",
        "-m",
        "backup migrated memory content",
        ...pathspecArgs,
      ],
      {
        cwd: config.projectPath,
        env: createGitCommandEnv(),
      },
    );
  });
  const committedState = await requireCurrentRecoveryGitState(config);
  if (
    committedState.repositoryRoot !== expectedState.repositoryRoot ||
    committedState.branch !== expectedState.branch ||
    committedState.remoteUrl !== expectedState.remoteUrl
  ) {
    throw new BackupFailsafeActionError(
      "backup git identity changed while committing recovery content; refresh and retry",
    );
  }
  return committedState;
}

async function pushRecoveredBackup(config: ResolvedTraumaConfig) {
  if (!config.backup.git.push || !(await hasConfiguredRemote(config))) {
    return;
  }

  try {
    await executeBuiltInGit([
      "push",
      config.backup.git.remote,
      `HEAD:${config.backup.git.branch}`,
    ], {
      cwd: config.projectPath,
      env: createGitCommandEnv(),
    });
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
  const result = await executeBuiltInGit(
    ["diff", "--cached", "--name-only", "-z"],
    {
      cwd: projectPath,
      env: createGitCommandEnv(),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const stagedPaths = new Set(result.stdout.split("\0").filter(Boolean));
  return stagePaths.some((path) => stagedPaths.has(path));
}

function isErrorWithCode(error: unknown, code: string) {
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
    const result = await executeBuiltInGit(["rev-parse", "--show-toplevel"], {
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

export class BackupFailsafeRestartRequiredError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "BackupFailsafeRestartRequiredError";
    this.cause = cause;
  }
}
