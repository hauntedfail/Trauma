import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { eq } from "drizzle-orm";

import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db/repositories";
import * as schema from "../db/schema";
import { executeBuiltInGit } from "./git-command";

export interface InconsistentBackupContent {
  memoryId: string;
  contentPath: string;
  reason:
    | "absolute_path"
    | "outside_backup_paths"
    | "missing_file"
    | "untracked_file";
  absolutePath?: string;
  stagePath?: string;
}

const MAX_GIT_INDEX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface BackupContentIntegrityDependencies {
  listTrackedPaths?: (projectPath: string) => Promise<ReadonlySet<string>>;
}

export async function findInconsistentSuccessfulBackupContent(
  config: ResolvedTraumaConfig,
  db: TraumaDatabase,
  dependencies: BackupContentIntegrityDependencies = {},
) {
  const rows = await db
    .select({ id: schema.memories.id, contentPath: schema.memories.contentPath })
    .from(schema.memories)
    .where(eq(schema.memories.backupStatus, "success"))
    .all();

  if (rows.length === 0) {
    return null;
  }

  const trackedPaths = await (
    dependencies.listTrackedPaths ?? listGitTrackedPaths
  )(config.projectPath);

  for (const row of rows) {
    const resolved = resolveBackupContentPath(config, row.contentPath);
    if (resolved === "absolute_path" || resolved === "outside_backup_paths") {
      return {
        memoryId: row.id,
        contentPath: row.contentPath,
        reason: resolved,
      } satisfies InconsistentBackupContent;
    }

    if (!existsSync(resolved.absolutePath)) {
      return {
        memoryId: row.id,
        contentPath: row.contentPath,
        reason: "missing_file",
        absolutePath: resolved.absolutePath,
        stagePath: resolved.stagePath,
      } satisfies InconsistentBackupContent;
    }

    if (!trackedPaths.has(resolved.stagePath)) {
      return {
        memoryId: row.id,
        contentPath: row.contentPath,
        reason: "untracked_file",
        absolutePath: resolved.absolutePath,
        stagePath: resolved.stagePath,
      } satisfies InconsistentBackupContent;
    }
  }

  return null;
}

export function formatContentInconsistencyError(
  content: InconsistentBackupContent,
) {
  const details = [
    `memoryId=${content.memoryId}`,
    `contentPath=${content.contentPath}`,
    `reason=${content.reason}`,
  ];

  if (content.stagePath !== undefined) {
    details.push(`gitPath=${content.stagePath}`);
  }
  if (content.absolutePath !== undefined) {
    details.push(`absolutePath=${content.absolutePath}`);
  }

  return `successful backup content is missing or untracked: ${details.join(", ")}`;
}

function resolveBackupContentPath(
  config: ResolvedTraumaConfig,
  contentPath: string,
) {
  if (isAbsolute(contentPath)) {
    return "absolute_path";
  }

  const absoluteContentPath = resolve(config.storePath, contentPath);
  if (
    !isInside(config.storePath, absoluteContentPath) ||
    !isInside(config.projectPath, absoluteContentPath)
  ) {
    return "outside_backup_paths";
  }

  return {
    absolutePath: absoluteContentPath,
    stagePath: relative(config.projectPath, absoluteContentPath).split(sep).join("/"),
  };
}

async function listGitTrackedPaths(projectPath: string): Promise<ReadonlySet<string>> {
  try {
    const { stdout } = await executeBuiltInGit(["ls-files", "--no-sparse", "-z"], {
      cwd: projectPath,
      env: createGitCommandEnv(),
      maxBuffer: MAX_GIT_INDEX_OUTPUT_BYTES,
    });
    return new Set(stdout.split("\0").filter((path) => path.length > 0));
  } catch {
    return new Set();
  }
}

function isInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function createGitCommandEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
