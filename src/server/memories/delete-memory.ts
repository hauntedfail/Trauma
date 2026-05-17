import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  runSerializedGitBackupJob,
  type MemoryBackupJob,
  type MemoryBackupQueue,
} from "../backup";
import { assertBackupEnvironmentReady } from "../backup/environment";
import type { ResolvedTraumaConfig } from "../config";
import {
  createRepositories,
  type TraumaDatabase,
  type TraumaRepositories,
} from "../db/repositories";
import { getFlashbackMetadataExportPath } from "../flashbacks/export";

export type DeleteMemoryResult =
  | { status: "deleted"; warnings?: DeleteMemoryWarning[] }
  | { status: "not_found" }
  | { status: "failed"; error: string };

export type DeleteMemoryWarning =
  | {
      kind: "backup_enqueue_failed";
      error: string;
    }
  | {
      kind: "content_cleanup_failed";
      error: string;
    };

type DeleteMemoryFileSystem = {
  access: typeof access;
  mkdir: typeof mkdir;
  rename: typeof rename;
  rm: typeof rm;
};

type DeleteMemoryRepositories = {
  memories: Pick<
    TraumaRepositories["memories"],
    "deleteMemoryRecord" | "findDeletionTarget"
  >;
};

export async function deleteMemory(input: {
  backupQueue?: MemoryBackupQueue;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  fileSystem?: Partial<DeleteMemoryFileSystem>;
  memoryId: string;
  repositories?: DeleteMemoryRepositories;
}): Promise<DeleteMemoryResult> {
  const repositories = input.repositories ?? createRepositories(input.db);
  const fileSystem = {
    access,
    mkdir,
    rename,
    rm,
    ...input.fileSystem,
  };
  const target = await repositories.memories.findDeletionTarget(input.memoryId);
  if (target === undefined) {
    return { status: "not_found" };
  }

  let paths: ReturnType<typeof resolveDeletionPaths>;
  try {
    paths = resolveDeletionPaths({
      storePath: input.config.storePath,
      memoryId: input.memoryId,
      contentPath: target.contentPath,
    });
  } catch (error) {
    return { status: "failed", error: formatUnknownError(error) };
  }
  let backupDeletionPaths: string[];
  try {
    backupDeletionPaths = resolveBackupDeletionPaths({
      contentPath: target.contentPath,
      memoryId: input.memoryId,
      storePath: input.config.storePath,
    });
  } catch (error) {
    return { status: "failed", error: formatUnknownError(error) };
  }

  await assertBackupEnvironmentReady({
    config: input.config,
    db: input.db,
  });

  let staged = false;
  try {
    await fileSystem.mkdir(dirname(paths.stagingDir), { recursive: true });
    await fileSystem.rename(paths.contentDir, paths.stagingDir);
    staged = true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      return { status: "failed", error: formatUnknownError(error) };
    }
  }

  const deletionBackupJob = createDeletionBackupJob({
    backupDeletionPaths,
    memoryId: input.memoryId,
  });
  let synchronousBackupCompleted = false;
  if (input.config.backup.git.enabled) {
    try {
      await runSerializedGitBackupJob({
        config: input.config,
        job: deletionBackupJob,
      });
      synchronousBackupCompleted = true;
    } catch (error) {
      const restoreError = staged
        ? await restoreStagedContent({ fileSystem, paths })
        : undefined;
      const backupRestoreError =
        staged && restoreError === undefined
          ? await restoreDeletionBackupState({
              config: input.config,
              deletionBackupJob,
            })
          : undefined;
      return {
        status: "failed",
        error: formatFailureMessage([
          `Failed to back up memory deletion before deleting the memory row: ${formatUnknownError(error)}`,
          restoreError,
          backupRestoreError,
        ]),
      };
    }
  }

  try {
    const deleted = await repositories.memories.deleteMemoryRecord(input.memoryId);
    if (!deleted) {
      const restoreError = staged
        ? await restoreStagedContent({ fileSystem, paths })
        : undefined;
      const backupRestoreError =
        synchronousBackupCompleted && restoreError === undefined
          ? await restoreDeletionBackupState({
              config: input.config,
              deletionBackupJob,
            })
          : undefined;
      if (restoreError !== undefined || backupRestoreError !== undefined) {
        return {
          status: "failed",
          error: formatFailureMessage([restoreError, backupRestoreError]),
        };
      }
      return { status: "not_found" };
    }
  } catch (error) {
    const restoreError = staged
      ? await restoreStagedContent({ fileSystem, paths })
      : undefined;
    const backupRestoreError =
      synchronousBackupCompleted && restoreError === undefined
        ? await restoreDeletionBackupState({
            config: input.config,
            deletionBackupJob,
          })
        : undefined;
    return {
      status: "failed",
      error: formatFailureMessage([
        formatUnknownError(error),
        restoreError,
        backupRestoreError,
      ]),
    };
  }

  const warnings: DeleteMemoryWarning[] = [];
  if (staged) {
    try {
      await fileSystem.rm(paths.stagingDir, { recursive: true, force: true });
    } catch (error) {
      warnings.push({
        kind: "content_cleanup_failed",
        error: `Failed to remove staged memory content at ${paths.stagingDir}: ${formatUnknownError(error)}`,
      });
    }
  }

  if (!input.config.backup.git.enabled && input.backupQueue !== undefined) {
    try {
      await input.backupQueue.enqueue({
        memoryId: input.memoryId,
        contentPaths: backupDeletionPaths,
        reason: "memory_deletion",
      });
    } catch (error) {
      warnings.push({
        kind: "backup_enqueue_failed",
        error: formatUnknownError(error),
      });
    }
  }

  return warnings.length > 0 ? { status: "deleted", warnings } : { status: "deleted" };
}

function createDeletionBackupJob(input: {
  memoryId: string;
  backupDeletionPaths: string[];
}): MemoryBackupJob {
  return {
    memoryId: input.memoryId,
    contentPaths: input.backupDeletionPaths,
    reason: "memory_deletion",
  };
}

async function restoreStagedContent(input: {
  fileSystem: DeleteMemoryFileSystem;
  paths: ReturnType<typeof resolveDeletionPaths>;
}): Promise<string | undefined> {
  try {
    await input.fileSystem.rename(input.paths.stagingDir, input.paths.contentDir);
    return undefined;
  } catch (error) {
    return `Failed to restore staged memory content from ${input.paths.stagingDir}: ${formatUnknownError(error)}`;
  }
}

async function restoreDeletionBackupState(input: {
  config: ResolvedTraumaConfig;
  deletionBackupJob: MemoryBackupJob;
}): Promise<string | undefined> {
  try {
    await runSerializedGitBackupJob({
      config: input.config,
      job: {
        ...input.deletionBackupJob,
        reason: "memory_creation",
      },
    });
    return undefined;
  } catch (error) {
    return `Failed to restore git backup state after database deletion failed: ${formatUnknownError(error)}`;
  }
}

function formatFailureMessage(messages: Array<string | undefined>): string {
  return messages.filter((message) => message !== undefined).join("; ");
}

function resolveDeletionPaths(input: {
  storePath: string;
  memoryId: string;
  contentPath: string;
}): { contentDir: string; stagingDir: string } {
  const storeRoot = resolve(input.storePath);
  const contentFile = resolve(storeRoot, input.contentPath);
  assertPathInsideStore(storeRoot, contentFile);

  const contentDir = dirname(contentFile);
  assertPathInsideStore(storeRoot, contentDir);
  if (contentDir === storeRoot) {
    throw new Error("memory content path must resolve to a memory directory");
  }

  const stagingDir = resolve(
    storeRoot,
    ".delete-staging",
    `${input.memoryId}-${Date.now()}`,
  );
  assertPathInsideStore(storeRoot, stagingDir);

  return { contentDir, stagingDir };
}

function resolveBackupDeletionPaths(input: {
  contentPath: string;
  memoryId: string;
  storePath: string;
}): string[] {
  const paths = [input.contentPath];
  const flashbackExportPath = getFlashbackMetadataExportPath(input.memoryId);
  const absoluteFlashbackExportPath = resolve(input.storePath, flashbackExportPath);
  assertPathInsideStore(resolve(input.storePath), absoluteFlashbackExportPath);
  paths.push(flashbackExportPath);
  return paths;
}

function assertPathInsideStore(storeRoot: string, candidate: string): void {
  const normalizedStoreRoot = storeRoot.endsWith("/")
    ? storeRoot
    : `${storeRoot}/`;
  const normalizedCandidate = candidate.endsWith("/")
    ? candidate
    : `${candidate}/`;
  if (
    candidate !== storeRoot &&
    !normalizedCandidate.startsWith(normalizedStoreRoot)
  ) {
    throw new Error("memory content path escapes the configured store path");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
