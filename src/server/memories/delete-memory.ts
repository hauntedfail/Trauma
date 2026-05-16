import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { MemoryBackupQueue } from "../backup";
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
  | { status: "failed"; error: string; partial?: DeleteMemoryPartialFailure };

export type DeleteMemoryPartialFailure = "content_cleanup_failed";

export type DeleteMemoryWarning = {
  kind: "backup_enqueue_failed";
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
    backupDeletionPaths = await resolveBackupDeletionPaths({
      contentPath: target.contentPath,
      fileSystem,
      memoryId: input.memoryId,
      storePath: input.config.storePath,
    });
  } catch (error) {
    return { status: "failed", error: formatUnknownError(error) };
  }

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

  try {
    const deleted = await repositories.memories.deleteMemoryRecord(input.memoryId);
    if (!deleted) {
      if (staged) {
        await fileSystem.rename(paths.stagingDir, paths.contentDir);
      }
      return { status: "not_found" };
    }
  } catch (error) {
    if (staged) {
      await fileSystem.rename(paths.stagingDir, paths.contentDir);
    }
    return { status: "failed", error: formatUnknownError(error) };
  }

  if (staged) {
    try {
      await fileSystem.rm(paths.stagingDir, { recursive: true, force: true });
    } catch (error) {
      return {
        status: "failed",
        error: `Failed to remove staged memory content at ${paths.stagingDir}: ${formatUnknownError(error)}`,
        partial: "content_cleanup_failed",
      };
    }
  }

  const warnings: DeleteMemoryWarning[] = [];
  if (input.backupQueue !== undefined) {
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

async function resolveBackupDeletionPaths(input: {
  contentPath: string;
  fileSystem: DeleteMemoryFileSystem;
  memoryId: string;
  storePath: string;
}): Promise<string[]> {
  const paths = [input.contentPath];
  const flashbackExportPath = getFlashbackMetadataExportPath(input.memoryId);
  const absoluteFlashbackExportPath = resolve(input.storePath, flashbackExportPath);
  assertPathInsideStore(resolve(input.storePath), absoluteFlashbackExportPath);
  try {
    await input.fileSystem.access(absoluteFlashbackExportPath);
    paths.push(flashbackExportPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
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
