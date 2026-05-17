import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runGitBackupJob,
  type MemoryBackupQueue,
} from "../../../src/server/backup";
import { BackupEnvironmentFailsafeError } from "../../../src/server/backup/environment";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { writeFlashbackMetadataExport } from "../../../src/server/flashbacks/export";
import { deleteMemory } from "../../../src/server/memories/delete-memory";
import { writeMemoryContent } from "../../../src/server/store";
import {
  loadRouteConfig,
  routeMemoryId,
  routeNow,
  seedRouteMemory,
  writeRouteConfig,
} from "../routes/api-test-helpers";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("delete memory service", () => {
  it("queues deleted memory content and Flashback export paths for git backup", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    await writeFlashbackExport(config.storePath, routeMemoryId);
    const connection = initializeDatabase(config);
    const enqueued: Parameters<MemoryBackupQueue["enqueue"]>[0][] = [];
    const backupQueue = {
      enqueue: async (input) => {
        enqueued.push(input);
        return { backupStatus: "queued" };
      },
    } satisfies MemoryBackupQueue;

    try {
      await expect(
        deleteMemory({
          backupQueue,
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
    } finally {
      connection.close();
    }

    expect(enqueued).toEqual([
      {
        memoryId: routeMemoryId,
        contentPaths: [
          `memories/${routeMemoryId}/CONTENT.md`,
          `memories/${routeMemoryId}/FLASHBACKS.json`,
        ],
        reason: "memory_deletion",
      },
    ]);
  });

  it("queues the Flashback export deletion candidate when the file is already missing", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    const connection = initializeDatabase(config);
    const enqueued: Parameters<MemoryBackupQueue["enqueue"]>[0][] = [];
    const backupQueue = {
      enqueue: async (input) => {
        enqueued.push(input);
        return { backupStatus: "queued" };
      },
    } satisfies MemoryBackupQueue;

    try {
      await expect(
        deleteMemory({
          backupQueue,
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
    } finally {
      connection.close();
    }

    expect(enqueued).toEqual([
      {
        memoryId: routeMemoryId,
        contentPaths: [
          `memories/${routeMemoryId}/CONTENT.md`,
          `memories/${routeMemoryId}/FLASHBACKS.json`,
        ],
        reason: "memory_deletion",
      },
    ]);
  });

  it("backs up tracked memory deletion before dropping the SQLite row", async () => {
    const root = await makeRoot();
    const loadedConfig = loadRouteConfig(await writeRouteConfig(root));
    const config = {
      ...loadedConfig,
      backup: {
        git: {
          ...loadedConfig.backup.git,
          enabled: true,
          commitMessageTemplate: "backup {action} {memoryId}",
        },
      },
    };
    await initializeGitRepository(config.projectPath);
    await stampBackupEnvironment(config);
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    await writeFlashbackExport(config.storePath, routeMemoryId);
    await runGitBackupJob({
      config,
      job: {
        memoryId: routeMemoryId,
        contentPaths: [
          `memories/${routeMemoryId}/CONTENT.md`,
          `memories/${routeMemoryId}/FLASHBACKS.json`,
        ],
        reason: "memory_creation",
      },
    });

    const connection = initializeDatabase(config);
    try {
      await expect(
        deleteMemory({
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }

    expect(git(config.projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      `backup deleted memory ${routeMemoryId}`,
    );
    expect(
      git(config.projectPath, ["show", "--name-status", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([
      `D\tstorage/memories/${routeMemoryId}/CONTENT.md`,
      `D\tstorage/memories/${routeMemoryId}/FLASHBACKS.json`,
    ]);
  });

  it("backs up untracked memory content before staging git deletion", async () => {
    const root = await makeRoot();
    const loadedConfig = loadRouteConfig(await writeRouteConfig(root));
    const config = {
      ...loadedConfig,
      backup: {
        git: {
          ...loadedConfig.backup.git,
          enabled: true,
          commitMessageTemplate: "backup {action} {memoryId}",
        },
      },
    };
    await initializeGitRepository(config.projectPath);
    await stampBackupEnvironment(config);
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nUntracked content.",
    });

    const connection = initializeDatabase(config);
    try {
      await expect(
        deleteMemory({
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }

    expect(git(config.projectPath, ["log", "--pretty=%s", "-2"]).trim().split(/\r?\n/))
      .toEqual([
        `backup deleted memory ${routeMemoryId}`,
        `backup created memory ${routeMemoryId}`,
      ]);
    expect(
      git(config.projectPath, [
        "show",
        "--name-status",
        "--pretty=format:",
        "HEAD~1",
      ])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([`A\tstorage/memories/${routeMemoryId}/CONTENT.md`]);
    expect(
      git(config.projectPath, ["show", "--name-status", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([`D\tstorage/memories/${routeMemoryId}/CONTENT.md`]);
  });

  it("restores the local git backup state when deletion push fails", async () => {
    const root = await makeRoot();
    const loadedConfig = loadRouteConfig(await writeRouteConfig(root));
    const missingRemotePath = join(root, "missing.git");
    const localCommitConfig = {
      ...loadedConfig,
      backup: {
        git: {
          ...loadedConfig.backup.git,
          enabled: true,
          push: false,
          commitMessageTemplate: "backup {action} {memoryId}",
        },
      },
    };
    const config = {
      ...localCommitConfig,
      backup: {
        git: {
          ...localCommitConfig.backup.git,
          push: true,
        },
      },
    };
    await initializeGitRepository(config.projectPath);
    git(config.projectPath, ["remote", "add", "origin", missingRemotePath]);
    const stampConnection = initializeDatabase(config);
    try {
      await stampConnection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: config.projectPath,
        storePath: config.storePath,
        gitRemote: config.backup.git.remote,
        gitRemoteUrl: missingRemotePath,
        gitBranch: config.backup.git.branch,
        createdAt: routeNow,
        updatedAt: routeNow,
      });
    } finally {
      stampConnection.close();
    }
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    await writeFlashbackExport(config.storePath, routeMemoryId);
    await runGitBackupJob({
      config: localCommitConfig,
      job: {
        memoryId: routeMemoryId,
        contentPaths: [
          `memories/${routeMemoryId}/CONTENT.md`,
          `memories/${routeMemoryId}/FLASHBACKS.json`,
        ],
        reason: "memory_creation",
      },
    });

    const connection = initializeDatabase(config);
    try {
      const result = await deleteMemory({
        config,
        db: connection.db,
        memoryId: routeMemoryId,
      });

      expect(result.status).toBe("failed");
      expect(result.status === "failed" ? result.error : "").toContain(
        "Failed to back up memory deletion before deleting the memory row",
      );
      expect(result.status === "failed" ? result.error : "").toContain(
        "Failed to restore git backup state after database deletion failed",
      );
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }

    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).resolves.toContain("# Route Memory");
    expect(git(config.projectPath, ["log", "--pretty=%s", "-3"]).trim().split(/\r?\n/))
      .toEqual([
        `backup created memory ${routeMemoryId}`,
        `backup deleted memory ${routeMemoryId}`,
        `backup created memory ${routeMemoryId}`,
      ]);
    expect(
      git(config.projectPath, ["show", "--name-status", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([
      `A\tstorage/memories/${routeMemoryId}/CONTENT.md`,
      `A\tstorage/memories/${routeMemoryId}/FLASHBACKS.json`,
    ]);
  });

  it("blocks deletion before moving content when the backup failsafe is active", async () => {
    const root = await makeRoot();
    const loadedConfig = loadRouteConfig(await writeRouteConfig(root));
    const config = {
      ...loadedConfig,
      backup: {
        git: {
          ...loadedConfig.backup.git,
          enabled: true,
        },
      },
    };
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    const connection = initializeDatabase(config);

    try {
      await expect(
        deleteMemory({
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).rejects.toBeInstanceOf(BackupEnvironmentFailsafeError);
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }
    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).resolves.toContain("# Route Memory");
  });

  it("returns deleted with a warning when backup enqueue fails after local deletion", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    const connection = initializeDatabase(config);
    const backupQueue = {
      enqueue: async () => {
        throw new Error("backup queue is down");
      },
    } satisfies MemoryBackupQueue;

    try {
      await expect(
        deleteMemory({
          backupQueue,
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({
        status: "deleted",
        warnings: [
          {
            kind: "backup_enqueue_failed",
            error: "backup queue is down",
          },
        ],
      });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }

    await expect(access(join(config.storePath, "memories", routeMemoryId)))
      .rejects.toThrow();
  });

  it("returns deleted with a warning when staged content cleanup fails", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });
    const connection = initializeDatabase(config);

    try {
      const result = await deleteMemory({
        config,
        db: connection.db,
        fileSystem: {
          rm: async () => {
            throw new Error("staging cleanup denied");
          },
        },
        memoryId: routeMemoryId,
      });

      expect(result).toMatchObject({
        status: "deleted",
        warnings: [
          {
            kind: "content_cleanup_failed",
          },
        ],
      });
      expect(result.status === "deleted" ? result.warnings?.[0]?.error : "")
        .toContain("staging cleanup denied");
      expect(result.status === "deleted" ? result.warnings?.[0]?.error : "")
        .toContain(".delete-staging");
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });

  it("restores staged content when database deletion fails", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await writeMemoryContent({
      config,
      memoryId: routeMemoryId,
      frontmatter: {
        id: routeMemoryId,
        url: `https://example.com/${routeMemoryId}`,
        title: "Route Memory",
        capturedAt: routeNow.toISOString(),
        extractionStatus: "success",
      },
      markdown: "# Route Memory\n\nContent.",
    });

    const connection = initializeDatabase(config);
    try {
      const result = await deleteMemory({
        config,
        db: connection.db,
        memoryId: routeMemoryId,
        repositories: {
          memories: {
            findDeletionTarget: async () => ({
              id: routeMemoryId,
              contentPath: `memories/${routeMemoryId}/CONTENT.md`,
            }),
            deleteMemoryRecord: async () => {
              throw new Error("database delete failed");
            },
          },
        },
      });

      expect(result).toEqual({
        status: "failed",
        error: "database delete failed",
      });
    } finally {
      connection.close();
    }
    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).resolves.toContain("# Route Memory");
  });

  it("deletes the row when the content directory is already missing", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config);
    const connection = initializeDatabase(config);

    try {
      await expect(
        deleteMemory({
          config,
          db: connection.db,
          memoryId: routeMemoryId,
        }),
      ).resolves.toEqual({ status: "deleted" });
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-delete-memory-"));
  tempDirs.push(root);
  return root;
}

async function initializeGitRepository(projectPath: string): Promise<void> {
  await mkdir(projectPath, { recursive: true });
  git(projectPath, ["init", "--initial-branch=main"]);
  git(projectPath, ["config", "user.name", "Trauma Tests"]);
  git(projectPath, ["config", "user.email", "trauma@example.invalid"]);
}

async function stampBackupEnvironment(
  config: ResolvedTraumaConfig,
): Promise<void> {
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
      id: "default",
      projectPath: config.projectPath,
      storePath: config.storePath,
      gitRemote: config.backup.git.remote,
      gitRemoteUrl: null,
      gitBranch: config.backup.git.branch,
      createdAt: routeNow,
      updatedAt: routeNow,
    });
  } finally {
    connection.close();
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: createChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

async function writeFlashbackExport(
  storePath: string,
  memoryId: string,
): Promise<void> {
  await writeFlashbackMetadataExport({
    config: { storePath },
    memoryId,
    flashbacks: [],
  });
}
