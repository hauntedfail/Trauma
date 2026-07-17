import { access, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import {
  runSerializedGitBackupJob,
  type MemoryBackupJob,
  type MemoryBackupQueue,
} from "../backup";
import {
  assertBackupEnvironmentReady,
} from "../backup/environment";
import type { ResolvedTraumaConfig } from "../config";
import {
  syncDirectoryBestEffort,
  type DirectorySyncFileSystem,
} from "../files/atomic-write";
import {
  createRepositories,
  type TraumaDatabase,
  type TraumaRepositories,
} from "../db/repositories";
import { getFlashbackMetadataExportPath } from "../flashbacks/export";
import { resolveMemoryContentPath } from "../store/memory-content";
import {
  clearMemoryOperationJournal,
  persistMemoryDeletionJournal,
  recoverInterruptedMemoryOperations,
  resolveMemoryDeletionStagingPath,
} from "./operation-journal";
import {
  withMemoryDeletionReservation,
  type MemoryDeletionReservation,
} from "./mutation-reservation";
import { acquireMemoryOperationMutationLease } from "./operation-coordination";

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
  openDirectory: DirectorySyncFileSystem["openDirectory"];
  rename: typeof rename;
  rm: typeof rm;
};

type DeleteMemoryRepositories = {
  memories: Pick<
    TraumaRepositories["memories"],
    "deleteMemoryRecord" | "findDeletionTarget"
  >;
};

type DeleteMemoryInput = {
  backupQueue?: MemoryBackupQueue;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  fileSystem?: Partial<DeleteMemoryFileSystem>;
  memoryId: string;
  repositories?: DeleteMemoryRepositories;
};

export async function deleteMemory(
  input: DeleteMemoryInput,
): Promise<DeleteMemoryResult> {
  const databaseRepositories = createRepositories(input.db);
  await recoverInterruptedMemoryOperations({
    completeMissingDeletionBackup: async (deletion) => {
      await assertBackupEnvironmentReady({
        config: input.config,
        db: input.db,
      });
      await runSerializedGitBackupJob({
        config: input.config,
        job: { ...deletion, reason: "memory_deletion" },
      });
    },
    config: input.config,
    memories: databaseRepositories.memories,
  });
  return withMemoryDeletionReservation(
    { memoryId: input.memoryId, storePath: input.config.storePath },
    (reservation) => deleteMemoryReserved(
      input,
      databaseRepositories,
      reservation,
    ),
  );
}

async function deleteMemoryReserved(
  input: DeleteMemoryInput,
  databaseRepositories: TraumaRepositories,
  reservation: MemoryDeletionReservation,
): Promise<DeleteMemoryResult> {
  const repositories = input.repositories ?? databaseRepositories;
  const fileSystem = {
    access,
    mkdir,
    openDirectory: (path: string) => open(path, "r"),
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

  const deletionBackupJob = createDeletionBackupJob({
    backupDeletionPaths,
    memoryId: input.memoryId,
  });
  if (input.config.backup.git.enabled) {
    try {
      await runSerializedGitBackupJob({
        config: withLocalGitBackupOnly(input.config),
        job: createPreDeletionContentBackupJob({
          backupDeletionPaths,
          memoryId: input.memoryId,
        }),
      });
    } catch (error) {
      return {
        status: "failed",
        error: `Failed to back up memory content before deleting the memory row: ${formatUnknownError(error)}`,
      };
    }
  }

  const warnings: DeleteMemoryWarning[] = [];
  const releaseOperationLease = await acquireMemoryOperationMutationLease(
    input.config.storePath,
  );
  try {
    try {
      await persistMemoryDeletionJournal({
        config: input.config,
        journal: {
          version: 1,
          kind: "memory_deletion",
          memoryId: input.memoryId,
          contentPath: target.contentPath,
          stagingPath: paths.stagingRelativePath,
        },
      });
    } catch (error) {
      return { status: "failed", error: formatUnknownError(error) };
    }

  let staged = false;
  try {
    const stagingParent = dirname(paths.stagingDir);
    await fileSystem.mkdir(stagingParent, { recursive: true });
    await syncDirectoryBestEffort(dirname(stagingParent), fileSystem);
    reservation.assertExclusive();
    await fileSystem.rename(paths.contentDir, paths.stagingDir);
    staged = true;
    await syncRenamedDirectoryEntries({
      destination: paths.stagingDir,
      fileSystem,
      source: paths.contentDir,
    });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      const restoreError = staged
        ? await restoreStagedContent({ fileSystem, paths })
        : undefined;
      if (staged && restoreError === undefined) {
        await clearMemoryOperationJournal({
          config: input.config,
          memoryId: input.memoryId,
        }).catch(() => undefined);
      }
      return {
        status: "failed",
        error: formatFailureMessage([
          formatUnknownError(error),
          restoreError,
        ]),
      };
    }
  }

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
      if (restoreError === undefined && backupRestoreError === undefined) {
        await clearMemoryOperationJournal({
          config: input.config,
          memoryId: input.memoryId,
        }).catch(() => undefined);
      }
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
    reservation.assertExclusive();
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
      if (restoreError === undefined && backupRestoreError === undefined) {
        await clearMemoryOperationJournal({
          config: input.config,
          memoryId: input.memoryId,
        }).catch(() => undefined);
      }
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
    if (restoreError === undefined && backupRestoreError === undefined) {
      await clearMemoryOperationJournal({
        config: input.config,
        memoryId: input.memoryId,
      }).catch(() => undefined);
    }
    return {
      status: "failed",
      error: formatFailureMessage([
        formatUnknownError(error),
        restoreError,
        backupRestoreError,
      ]),
    };
  }

    let stagedContentCleaned = true;
    if (staged) {
      try {
        await fileSystem.rm(paths.stagingDir, { recursive: true, force: true });
        await syncDirectoryBestEffort(dirname(paths.stagingDir), fileSystem);
      } catch (error) {
        stagedContentCleaned = false;
        warnings.push({
          kind: "content_cleanup_failed",
          error: `Failed to remove staged memory content at ${paths.stagingDir}: ${formatUnknownError(error)}`,
        });
      }
    }
    if (stagedContentCleaned) {
      try {
        await clearMemoryOperationJournal({
          config: input.config,
          memoryId: input.memoryId,
        });
      } catch (error) {
        warnings.push({
          kind: "content_cleanup_failed",
          error: `Failed to remove the completed memory deletion journal: ${formatUnknownError(error)}`,
        });
      }
    }
  } finally {
    releaseOperationLease();
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

function createPreDeletionContentBackupJob(input: {
  memoryId: string;
  backupDeletionPaths: string[];
}): MemoryBackupJob {
  return {
    memoryId: input.memoryId,
    contentPaths: input.backupDeletionPaths,
    reason: "memory_creation",
  };
}

function withLocalGitBackupOnly(config: ResolvedTraumaConfig): ResolvedTraumaConfig {
  if (!config.backup.git.push) {
    return config;
  }

  return {
    ...config,
    backup: {
      git: {
        ...config.backup.git,
        push: false,
      },
    },
  };
}

async function restoreStagedContent(input: {
  fileSystem: DeleteMemoryFileSystem;
  paths: ReturnType<typeof resolveDeletionPaths>;
}): Promise<string | undefined> {
  try {
    await input.fileSystem.rename(input.paths.stagingDir, input.paths.contentDir);
    await syncRenamedDirectoryEntries({
      destination: input.paths.contentDir,
      fileSystem: input.fileSystem,
      source: input.paths.stagingDir,
    });
    return undefined;
  } catch (error) {
    return `Failed to restore staged memory content from ${input.paths.stagingDir}: ${formatUnknownError(error)}`;
  }
}

async function syncRenamedDirectoryEntries(input: {
  destination: string;
  fileSystem: DirectorySyncFileSystem;
  source: string;
}): Promise<void> {
  const sourceParent = dirname(input.source);
  const destinationParent = dirname(input.destination);
  await syncDirectoryBestEffort(sourceParent, input.fileSystem);
  if (destinationParent !== sourceParent) {
    await syncDirectoryBestEffort(destinationParent, input.fileSystem);
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
}): { contentDir: string; stagingDir: string; stagingRelativePath: string } {
  const storeRoot = resolve(input.storePath);
  const expectedContent = resolveMemoryContentPath(
    { storePath: input.storePath },
    input.memoryId,
  );
  if (input.contentPath !== expectedContent.relativePath) {
    throw new Error("memory content path is not owned by the requested memory");
  }
  const contentFile = expectedContent.absolutePath;

  const contentDir = dirname(contentFile);
  assertPathInsideStore(storeRoot, contentDir);
  if (contentDir === storeRoot) {
    throw new Error("memory content path must resolve to a memory directory");
  }

  const staging = resolveMemoryDeletionStagingPath({
    memoryId: input.memoryId,
    storePath: input.storePath,
  });
  const stagingDir = staging.absolutePath;
  assertPathInsideStore(storeRoot, stagingDir);

  return {
    contentDir,
    stagingDir,
    stagingRelativePath: staging.relativePath,
  };
}

function resolveBackupDeletionPaths(input: {
  contentPath: string;
  memoryId: string;
  storePath: string;
}): string[] {
  const storeRoot = resolve(input.storePath);
  const contentFile = resolve(storeRoot, input.contentPath);
  assertPathInsideStore(storeRoot, contentFile);
  const memoryDirectory = dirname(contentFile);
  assertPathInsideStore(storeRoot, memoryDirectory);
  if (memoryDirectory === storeRoot) {
    throw new Error("memory content path must resolve to a memory directory");
  }
  const memoryDirectoryPath = relative(storeRoot, memoryDirectory)
    .split(sep)
    .join("/");
  const paths = [input.contentPath];
  const flashbackExportPath = getFlashbackMetadataExportPath(input.memoryId);
  const absoluteFlashbackExportPath = resolve(storeRoot, flashbackExportPath);
  assertPathInsideStore(storeRoot, absoluteFlashbackExportPath);
  paths.push(flashbackExportPath);
  paths.push(memoryDirectoryPath);
  return [...new Set(paths)];
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
