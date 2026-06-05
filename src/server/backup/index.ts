import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { ResolvedTraumaConfig } from "../config";
import {
  initializeDatabase,
  type TranslationRepository,
  type TraumaDatabaseConnection,
} from "../db";
import {
  assertBackupEnvironmentReady,
  assertBackupRepositoryRoot,
  clearBackupPushFailureAlert,
  hasConfiguredRemote,
  recordBackupPushFailureAlert,
} from "./environment";
import { BACKUP_STATUSES, type BackupStatus } from "./status";
import {
  getSourceFlashbackMetadataExportPath,
  getTranslatedFlashbackMetadataExportPath,
} from "../flashbacks/export";
import { isSupportedLanguageCode } from "../translation/languages";
import { resolveTranslatedMemoryProjectionPath } from "../translation/paths";

export { BACKUP_STATUSES };
export type { BackupStatus };

export type BackupTriggerReason =
  | "memory_creation"
  | "flashback_update"
  | "memory_deletion"
  | "translation_update"
  | "psychiatrist_thread_update"
  | "psychiatrist_response_regenerate";

export interface MemoryBackupJob {
  memoryId: string;
  contentPaths: readonly string[];
  reason: BackupTriggerReason;
}

export interface EnqueueMemoryBackupInput {
  memoryId: string;
  contentPath?: string;
  contentPaths?: readonly string[];
  reason?: BackupTriggerReason;
}

export interface EnqueueMemoryBackupResult {
  backupStatus: Extract<BackupStatus, "pending" | "queued" | "disabled">;
}

export interface MemoryBackupQueue {
  enqueue: (
    input: EnqueueMemoryBackupInput,
  ) => Promise<EnqueueMemoryBackupResult>;
}

export interface GitMemoryBackupQueue extends MemoryBackupQueue {
  drain: () => Promise<void>;
  retryEligibleBackups: () => Promise<number>;
}

export interface RunGitBackupJobInput {
  config: ResolvedTraumaConfig;
  job: MemoryBackupJob;
}

export type GitBackupJobRunner = (input: RunGitBackupJobInput) => Promise<void>;

export interface CreateGitMemoryBackupQueueInput {
  config: ResolvedTraumaConfig;
  now?: () => Date;
  runJob?: GitBackupJobRunner;
  openConnection?: (config: ResolvedTraumaConfig) => TraumaDatabaseConnection;
}

const execFileAsync = promisify(execFile);
const gitQueueByConfigKey = new Map<string, GitMemoryBackupQueue>();

export function createNoopMemoryBackupQueue(): MemoryBackupQueue {
  return {
    enqueue: async () => ({ backupStatus: "pending" }),
  };
}

export function getMemoryBackupQueue(
  config: ResolvedTraumaConfig,
): MemoryBackupQueue {
  if (!config.backup.git.enabled) {
    return createNoopMemoryBackupQueue();
  }

  const key = createQueueConfigKey(config);
  const existing = gitQueueByConfigKey.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const queue = createGitMemoryBackupQueue({ config });
  gitQueueByConfigKey.set(key, queue);
  void queue.retryEligibleBackups().catch(() => {
    // Startup retry failures are recorded per memory when jobs run. If the
    // retry scan itself fails, avoid making request handling depend on it.
  });
  return queue;
}

export function createGitMemoryBackupQueue(
  input: CreateGitMemoryBackupQueueInput,
): GitMemoryBackupQueue {
  const runJob = input.runJob ?? runSerializedGitBackupJob;
  const openConnection = input.openConnection ?? initializeDatabase;
  const now = input.now ?? (() => new Date());
  const pendingJobs: MemoryBackupJob[] = [];
  const pendingJobsByMemoryId = new Map<string, MemoryBackupJob>();
  const runningMemoryIds = new Set<string>();
  let worker: Promise<void> | undefined;

  function scheduleWorker() {
    if (worker !== undefined) {
      return;
    }

    worker = new Promise<void>((resolveWorker, rejectWorker) => {
      setTimeout(() => {
        void processJobs().then(resolveWorker, rejectWorker);
      }, 0);
    })
      .finally(() => {
        worker = undefined;
        if (pendingJobs.length > 0) {
          scheduleWorker();
        }
      });
  }

  async function processJobs() {
    while (pendingJobs.length > 0) {
      const job = pendingJobs.shift();
      if (job === undefined) {
        continue;
      }
      pendingJobsByMemoryId.delete(job.memoryId);
      runningMemoryIds.add(job.memoryId);

      try {
        await processJob(job);
      } finally {
        runningMemoryIds.delete(job.memoryId);
      }
    }
  }

  async function processJob(job: MemoryBackupJob) {
    try {
      await updateBackupStatus({
        memoryId: job.memoryId,
        backupStatus: "queued",
        lastBackupError: null,
      });
      await runJob({ config: input.config, job });
      await updateBackupStatus({
        memoryId: job.memoryId,
        backupStatus: "success",
        lastBackupAt: now(),
        lastBackupError: null,
      });
    } catch (error) {
      try {
        await updateBackupStatus({
          memoryId: job.memoryId,
          backupStatus: "failed",
          lastBackupError: formatUnknownError(error),
        });
      } catch {
        // Preserve the original backup failure. A missing row or closed DB must
        // not stop later queued backups in the same process.
      }
    }
  }

  async function updateBackupStatus(inputStatus: {
    memoryId: string;
    backupStatus: BackupStatus;
    lastBackupAt?: Date | null;
    lastBackupError?: string | null;
  }) {
    const connection = openConnection(input.config);
    try {
      await connection.repositories.memories.updateBackupStatus({
        id: inputStatus.memoryId,
        backupStatus: inputStatus.backupStatus,
        lastBackupAt: inputStatus.lastBackupAt,
        lastBackupError: inputStatus.lastBackupError,
        updatedAt: now(),
      });
    } finally {
      connection.close();
    }
  }

  async function enqueue(
    enqueueInput: EnqueueMemoryBackupInput,
  ): Promise<EnqueueMemoryBackupResult> {
    if (!input.config.backup.git.enabled) {
      return { backupStatus: "disabled" };
    }

    const job = normalizeBackupJob(enqueueInput);
    if (job.reason === "memory_deletion") {
      throw new GitBackupError(
        "memory deletion backups must run synchronously before deleting the memory row",
      );
    }
    const pendingJob = pendingJobsByMemoryId.get(job.memoryId);
    if (pendingJob !== undefined) {
      mergeBackupJobs(pendingJob, job);
      return { backupStatus: "queued" };
    }

    pendingJobs.push(job);
    pendingJobsByMemoryId.set(job.memoryId, job);
    scheduleWorker();
    return { backupStatus: "queued" };
  }

  return {
    enqueue,
    drain: async () => {
      while (worker !== undefined) {
        await worker;
      }
    },
    retryEligibleBackups: async () => {
      if (!input.config.backup.git.enabled) {
        return 0;
      }

      const connection = openConnection(input.config);
      try {
        await assertBackupEnvironmentReady({
          config: input.config,
          db: connection.db,
        });
        const backups =
          await connection.repositories.memories.listBackupsEligibleForRetry();
        let enqueued = 0;
        for (const backup of backups) {
          if (
            pendingJobsByMemoryId.has(backup.id) ||
            runningMemoryIds.has(backup.id)
          ) {
            continue;
          }
          await enqueue({
            memoryId: backup.id,
            contentPaths: await getRetryContentPaths(
              input.config,
              backup,
              connection.repositories.translations,
            ),
            reason: "memory_creation",
          });
          enqueued += 1;
        }
        return enqueued;
      } finally {
        connection.close();
      }
    },
  };
}

async function getRetryContentPaths(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  backup: { id: string; contentPath: string },
  translations: TranslationRepository,
): Promise<string[]> {
  const paths = [
    backup.contentPath,
    getSourceFlashbackMetadataExportPath(backup.id),
  ];
  const completeTranslations =
    await translations.listCompleteTranslationRecordsForMemory(backup.id);
  for (const translation of completeTranslations) {
    if (translation.outputPath !== null) {
      paths.push(translation.outputPath);
    }
    if (!isSupportedLanguageCode(translation.langCode)) {
      continue;
    }
    paths.push(
      resolveTranslatedMemoryProjectionPath({
        config,
        langCode: translation.langCode,
        memoryId: backup.id,
      }).relativePath,
      getTranslatedFlashbackMetadataExportPath({
        langCode: translation.langCode,
        memoryId: backup.id,
      }),
    );
  }
  paths.push(...getPsychiatristRetryContentPaths(config, backup.id));
  return [...new Set(paths.map((contentPath) =>
    validateRetryContentPath(config, contentPath)
  ))];
}

function getPsychiatristRetryContentPaths(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  memoryId: string,
): string[] {
  const threadsRoot = resolve(config.storePath, "memories", memoryId, "threads");
  const threadIds = readDirectoryNames(threadsRoot);
  const paths: string[] = [];
  for (const threadId of threadIds) {
    const threadBase = `memories/${memoryId}/threads/${threadId}`;
    paths.push(
      `${threadBase}/THREAD.json`,
      `${threadBase}/THREAD.md`,
      `${threadBase}/PAIRS.jsonl`,
    );
    const pairIds = readDirectoryNames(resolve(threadsRoot, threadId, "pairs"));
    for (const pairId of pairIds) {
      const pairBase = `${threadBase}/pairs/${pairId}`;
      paths.push(
        `${pairBase}/PROMPT.md`,
        `${pairBase}/CONTEXT.json`,
        `${pairBase}/RESPONSE.md`,
      );
    }
  }
  return paths;
}

function readDirectoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function validateRetryContentPath(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  contentPath: string,
): string {
  const absoluteContentPath = resolve(config.storePath, contentPath);
  if (isAbsolute(contentPath) || !isInside(config.storePath, absoluteContentPath)) {
    throw new GitBackupError(
      `git backup content path must stay under storePath: ${contentPath}`,
    );
  }
  return contentPath;
}

export async function runGitBackupJob(
  input: RunGitBackupJobInput,
): Promise<void> {
  if (!input.config.backup.git.enabled) {
    return;
  }

  await assertBackupRepositoryRoot(input.config);

  if (input.job.contentPaths.length === 0) {
    throw new GitBackupError("git backup job must include at least one content path");
  }

  const stagePaths = await resolveStagePaths(input.config, input.job.contentPaths);
  if (stagePaths.length === 0) {
    return;
  }

  await runGit(input.config.projectPath, ["add", "--", ...stagePaths]);
  const diffResult = await runGit(input.config.projectPath, [
    "diff",
    "--cached",
    "--quiet",
    "--",
    ...stagePaths,
  ], [0, 1]);
  if (diffResult.exitCode === 0) {
    if (input.config.backup.git.push) {
      await pushGitBackup(input.config);
    }
    return;
  }

  await runGit(input.config.projectPath, [
    "commit",
    "-m",
    formatCommitMessage(input.config.backup.git.commitMessageTemplate, input.job),
    "--",
    ...stagePaths,
  ]);

  if (input.config.backup.git.push) {
    await pushGitBackup(input.config);
  }
}

export function createSerializedGitBackupRunner(
  runJob: GitBackupJobRunner = runGitBackupJob,
): GitBackupJobRunner {
  const chainsByProjectPath = new Map<string, Promise<void>>();

  return async (input) => {
    const key = resolve(input.config.projectPath);
    const previous = chainsByProjectPath.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    chainsByProjectPath.set(key, current);

    await previous.catch(() => undefined);
    try {
      await runJob(input);
    } finally {
      release();
      if (chainsByProjectPath.get(key) === current) {
        chainsByProjectPath.delete(key);
      }
    }
  };
}

export const runSerializedGitBackupJob = createSerializedGitBackupRunner();

function normalizeBackupJob(input: EnqueueMemoryBackupInput): MemoryBackupJob {
  const contentPaths = input.contentPaths ?? (
    input.contentPath === undefined ? [] : [input.contentPath]
  );
  if (contentPaths.length === 0) {
    throw new GitBackupError("backup job must include at least one content path");
  }

  return {
    memoryId: input.memoryId,
    contentPaths,
    reason: input.reason ?? "memory_creation",
  };
}

function mergeBackupJobs(existing: MemoryBackupJob, incoming: MemoryBackupJob) {
  const contentPaths = new Set(existing.contentPaths);
  for (const contentPath of incoming.contentPaths) {
    contentPaths.add(contentPath);
  }
  existing.contentPaths = [...contentPaths];
  existing.reason = incoming.reason;
}

async function pushGitBackup(config: ResolvedTraumaConfig) {
  if (!(await hasConfiguredRemote(config))) {
    return;
  }

  try {
    await runGit(config.projectPath, [
      "push",
      config.backup.git.remote,
      `HEAD:${config.backup.git.branch}`,
    ]);
    await clearBackupPushFailureAlert(config);
  } catch (error) {
    await recordBackupPushFailureAlert(config, formatUnknownError(error));
    throw error;
  }
}

async function resolveStagePaths(
  config: ResolvedTraumaConfig,
  contentPaths: readonly string[],
): Promise<string[]> {
  const stagePaths: string[] = [];
  for (const contentPath of contentPaths) {
    const stagePath = resolveStagePath(config, contentPath);
    if (await shouldStagePath(config, stagePath)) {
      stagePaths.push(stagePath);
    }
  }
  return stagePaths;
}

async function shouldStagePath(
  config: ResolvedTraumaConfig,
  stagePath: string,
): Promise<boolean> {
  try {
    await access(resolve(config.projectPath, stagePath));
    return true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const tracked = await runGit(config.projectPath, [
    "ls-files",
    "--error-unmatch",
    "--",
    stagePath,
  ], [0, 1]);
  return tracked.exitCode === 0;
}

function resolveStagePath(config: ResolvedTraumaConfig, contentPath: string) {
  if (isAbsolute(contentPath)) {
    throw new GitBackupError(`git backup content path must be relative: ${contentPath}`);
  }

  const absoluteContentPath = resolve(config.storePath, contentPath);
  if (!isInside(config.storePath, absoluteContentPath)) {
    throw new GitBackupError(
      `git backup content path must stay under storePath: ${contentPath}`,
    );
  }

  if (!isInside(config.projectPath, absoluteContentPath)) {
    throw new GitBackupError(
      `git backup content path must stay under projectPath: ${contentPath}`,
    );
  }

  return relative(config.projectPath, absoluteContentPath).split(sep).join("/");
}

function isInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

async function runGit(
  cwd: string,
  args: string[],
  allowedExitCodes: readonly number[] = [0],
) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      env: createGitCommandEnv(),
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const exitCode = readExitCode(error);
    if (exitCode !== undefined && allowedExitCodes.includes(exitCode)) {
      return {
        exitCode,
        stdout: readProcessOutput(error, "stdout"),
        stderr: readProcessOutput(error, "stderr"),
      };
    }

    throw new GitBackupError(
      `git ${args[0] ?? "command"} failed: ${formatGitProcessError(error)}`,
    );
  }
}

function createGitCommandEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function readExitCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return undefined;
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

function formatCommitMessage(template: string, job: MemoryBackupJob) {
  return template
    .replaceAll("{action}", formatBackupAction(job.reason))
    .replaceAll("{memoryId}", job.memoryId)
    .replaceAll("{memory_id}", job.memoryId)
    .replaceAll("{reason}", job.reason);
}

function formatBackupAction(reason: BackupTriggerReason): string {
  switch (reason) {
    case "memory_creation":
      return "created memory";
    case "flashback_update":
      return "updated flashbacks";
    case "memory_deletion":
      return "deleted memory";
    case "translation_update":
      return "updated translation";
    case "psychiatrist_thread_update":
      return "updated psychiatrist thread";
    case "psychiatrist_response_regenerate":
      return "regenerated psychiatrist response";
  }
}

function createQueueConfigKey(config: ResolvedTraumaConfig) {
  return [
    config.databasePath,
    config.projectPath,
    config.storePath,
    config.backup.git.remote,
    config.backup.git.branch,
    String(config.backup.git.push),
    config.backup.git.commitMessageTemplate,
  ].join("\0");
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

export class GitBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitBackupError";
  }
}
