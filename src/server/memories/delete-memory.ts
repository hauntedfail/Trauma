import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import { createRepositories, type TraumaDatabase } from "../db/repositories";

export type DeleteMemoryResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "failed"; error: string };

export async function deleteMemory(input: {
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  memoryId: string;
}): Promise<DeleteMemoryResult> {
  const repositories = createRepositories(input.db);
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

  let staged = false;
  try {
    await mkdir(dirname(paths.stagingDir), { recursive: true });
    await rename(paths.contentDir, paths.stagingDir);
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
        await rename(paths.stagingDir, paths.contentDir);
      }
      return { status: "not_found" };
    }
  } catch (error) {
    if (staged) {
      await rename(paths.stagingDir, paths.contentDir);
    }
    return { status: "failed", error: formatUnknownError(error) };
  }

  if (staged) {
    await rm(paths.stagingDir, { recursive: true, force: true });
  }

  return { status: "deleted" };
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
