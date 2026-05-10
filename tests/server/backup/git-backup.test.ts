import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_STATUSES,
  createGitMemoryBackupQueue,
  runGitBackupJob,
  type MemoryBackupJob,
} from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";

const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef801";
const capturedAt = "2026-05-09T08:00:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("git backup runner", () => {
  it("uses the shared backup status source of truth", () => {
    expect([...BACKUP_STATUSES]).toEqual([
      "pending",
      "queued",
      "success",
      "failed",
      "disabled",
    ]);
  });

  it("stages only configured store content paths and creates a backup commit", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(
      join(storePath, contentPath),
      "# Backed Up\n\nMarkdown content.",
      "utf8",
    );
    await writeFile(join(projectPath, "outside.txt"), "leave me alone", "utf8");
    initializeGitRepository(projectPath);

    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: false }),
      job: createJob({ contentPaths: [contentPath] }),
    });

    expect(git(projectPath, ["status", "--short"]).trim()).toBe("?? outside.txt");
    expect(git(projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      `backup memory ${memoryId}`,
    );
    expect(
      git(projectPath, ["show", "--name-only", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([`store/${contentPath}`]);
  });

  it("does not push committed backup content when git push is disabled", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const remotePath = join(root, "remote.git");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Local Only", "utf8");
    git(root, ["init", "--bare", remotePath]);
    initializeGitRepository(projectPath);
    git(projectPath, ["remote", "add", "origin", remotePath]);

    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: false }),
      job: createJob({ contentPaths: [contentPath] }),
    });

    expect(hasRemoteMain(remotePath)).toBe(false);
  });
});

describe("git memory backup queue", () => {
  it("marks backup failure without removing the memory row or markdown content", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { existsSync } from "node:fs";
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { writeMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = ${JSON.stringify(memoryId)};
        const capturedAt = new Date(${JSON.stringify(capturedAt)});
        const config = createConfig(root);
        const connection = initializeDatabase(config);
        try {
          await writeMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
            frontmatter: {
              id: memoryId,
              url: "https://example.com/backup-failure",
              title: "Backup Failure",
              capturedAt: capturedAt.toISOString(),
              extractionStatus: "success",
            },
            markdown: "# Backup Failure\\n\\nThis content must survive.",
          });
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/backup-failure",
            title: "Backup Failure",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "pending",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: capturedAt,
            updatedAt: capturedAt,
          });
        } finally {
          connection.close();
        }

        const queue = createGitMemoryBackupQueue({
          config,
          now: () => new Date(${JSON.stringify(capturedAt)}),
        });
        const enqueueResult = await queue.enqueue({
          memoryId,
          contentPaths: [\`memories/\${memoryId}/CONTENT.md\`],
          reason: "memory_creation",
        });
        await queue.drain();

        const check = initializeDatabase(config);
        try {
          const stored = await check.repositories.memories.findById(memoryId);
          const contentExists = existsSync(join(config.storePath, \`memories/\${memoryId}/CONTENT.md\`));
          process.stdout.write(JSON.stringify({ enqueueResult, stored, contentExists }));
        } finally {
          check.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { enqueueResult, stored, contentExists } = JSON.parse(output);

    expect(enqueueResult).toEqual({ backupStatus: "queued" });
    expect(contentExists).toBe(true);
    expect(stored).toMatchObject({
      id: memoryId,
      title: "Backup Failure",
      backupStatus: "failed",
    });
    expect(stored.lastBackupError).toContain("git");
  });

  it("retries pending and failed backups once without duplicating active work", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const now = new Date(${JSON.stringify(capturedAt)});
        const config = createConfig(root);
        const ids = {
          pending: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
          failed: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
          success: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813",
        };
        const connection = initializeDatabase(config);
        try {
          for (const [statusName, id] of Object.entries(ids)) {
            await connection.repositories.memories.create({
              id,
              url: \`https://example.com/\${statusName}\`,
              title: statusName,
              description: null,
              faviconUrl: null,
              contentPath: \`memories/\${id}/CONTENT.md\`,
              extractionStatus: "success",
              extractionError: null,
              backupStatus: statusName === "success" ? "success" : statusName,
              lastBackupAt: statusName === "success" ? now : null,
              lastBackupError: statusName === "failed" ? "previous failure" : null,
              createdAt: now,
              updatedAt: now,
            });
          }
        } finally {
          connection.close();
        }

        const processed = [];
        const queue = createGitMemoryBackupQueue({
          config,
          now: () => now,
          runJob: async ({ job }) => {
            processed.push(job.memoryId);
          },
        });
        const retryCount = await queue.retryEligibleBackups();
        await queue.enqueue({
          memoryId: ids.pending,
          contentPaths: [\`memories/\${ids.pending}/CONTENT.md\`],
          reason: "memory_creation",
        });
        await queue.drain();

        const check = initializeDatabase(config);
        try {
          const rows = check.sqlite
            .prepare("select id, backup_status as backupStatus, last_backup_error as lastBackupError from memories order by id")
            .all();
          process.stdout.write(JSON.stringify({ retryCount, processed, rows }));
        } finally {
          check.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { retryCount, processed, rows } = JSON.parse(output);

    expect(retryCount).toBe(2);
    expect(processed).toEqual([
      "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
      "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
    ]);
    expect(rows).toEqual([
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
        backupStatus: "success",
        lastBackupError: null,
      },
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
        backupStatus: "success",
        lastBackupError: null,
      },
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813",
        backupStatus: "success",
        lastBackupError: null,
      },
    ]);
  });
});

async function makeRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function createConfig(input: {
  root: string;
  projectPath: string;
  storePath: string;
  push: boolean;
}): ResolvedTraumaConfig {
  return {
    configFilePath: join(input.root, "trauma.config.json"),
    projectPath: input.projectPath,
    storePath: input.storePath,
    databasePath: join(input.root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: true,
        remote: "origin",
        branch: "main",
        push: input.push,
        commitMessageTemplate: "backup memory {memoryId}",
      },
    },
  };
}

function createJob(input: { contentPaths: string[] }): MemoryBackupJob {
  return {
    memoryId,
    contentPaths: input.contentPaths,
    reason: "memory_creation",
  };
}

function initializeGitRepository(projectPath: string) {
  git(projectPath, ["init", "--initial-branch=main"]);
  git(projectPath, ["config", "user.name", "Trauma Tests"]);
  git(projectPath, ["config", "user.email", "trauma@example.invalid"]);
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: createChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasRemoteMain(remotePath: string) {
  try {
    git(remotePath, ["rev-parse", "--verify", "refs/heads/main"]);
    return true;
  } catch {
    return false;
  }
}

function runBunScript(script: string, root: string) {
  try {
    return execFileSync("bun", ["-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...createChildEnv(),
        TRAUMA_TEST_ROOT: root,
      },
    });
  } catch (error) {
    if (!isSpawnMissing(error)) {
      throw error;
    }

    const repositoryRoot = process.cwd();
    return execFileSync(
      "mise",
      ["exec", "-C", repositoryRoot, "--", "bun", "-e", script],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...createChildEnv(),
          MISE_TRUSTED_CONFIG_PATHS: join(repositoryRoot, "mise.toml"),
          TRAUMA_TEST_ROOT: root,
        },
      },
    );
  }
}

function isSpawnMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function createChildEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
