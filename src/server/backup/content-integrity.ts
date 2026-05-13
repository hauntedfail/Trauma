import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";

import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db/repositories";
import * as schema from "../db/schema";

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

const execFileAsync = promisify(execFile);

export async function findInconsistentSuccessfulBackupContent(
  config: ResolvedTraumaConfig,
  db: TraumaDatabase,
) {
  const rows = await db
    .select({ id: schema.memories.id, contentPath: schema.memories.contentPath })
    .from(schema.memories)
    .where(eq(schema.memories.backupStatus, "success"))
    .all();

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

    if (!(await isGitTracked(config.projectPath, resolved.stagePath))) {
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

async function isGitTracked(projectPath: string, stagePath: string) {
  try {
    await execFileAsync("git", ["ls-files", "--error-unmatch", "--", stagePath], {
      cwd: projectPath,
      env: createGitCommandEnv(),
    });
    return true;
  } catch {
    return false;
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
