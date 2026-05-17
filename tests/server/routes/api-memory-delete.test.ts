import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGitBackupJob } from "../../../src/server/backup";
import {
  DELETE,
  resolveDeleteMemoryBackupQueue,
} from "../../../src/routes/api/memories/[memoryId]";
import { initializeDatabase } from "../../../src/server/db";
import { writeMemoryContent } from "../../../src/server/store";
import {
  createApiEvent,
  loadRouteConfig,
  routeMemoryId,
  routeNow,
  seedRouteMemory,
  writeRouteConfig,
} from "./api-test-helpers";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("memory delete API route", () => {
  it("does not create the retry backup queue for Git-backed deletes", async () => {
    const root = await makeRoot();
    const configPath = await writeRouteConfig(root);
    const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
    rawConfig.backup.git.enabled = true;
    await writeFile(configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf8");
    const config = loadRouteConfig(configPath);
    let factoryCallCount = 0;

    const queue = resolveDeleteMemoryBackupQueue({
      config,
      getQueue: () => {
        factoryCallCount += 1;
        throw new Error("delete path must not start the backup retry queue");
      },
    });

    expect(queue).toBeUndefined();
    expect(factoryCallCount).toBe(0);
  });

  it("deletes a memory row and its content directory without deleting taxonomy records", async () => {
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
      const tag = await connection.repositories.taxonomy.createTag({
        id: "delete-tag",
        name: "delete",
        now: routeNow,
      });
      const category = await connection.repositories.taxonomy.createCategory({
        id: "delete-category",
        name: "Delete",
        now: routeNow,
      });
      await connection.repositories.taxonomy.attachTagToMemory({
        memoryId: routeMemoryId,
        tagId: tag.id,
        now: routeNow,
      });
      await connection.repositories.taxonomy.attachCategoryToMemory({
        memoryId: routeMemoryId,
        categoryId: category.id,
        now: routeNow,
      });
      connection.sqlite
        .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("delete-flashback", routeMemoryId, "Content", "", ".", 0, 7, routeNow.getTime(), routeNow.getTime());
      connection.sqlite
        .prepare("insert into moments (id, memory_id, section_anchor, section_title, section_level, section_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("delete-moment", routeMemoryId, "chapter", "Chapter", 2, "1/1", routeNow.getTime(), routeNow.getTime());
    } finally {
      connection.close();
    }

    const response = await DELETE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${routeMemoryId}`, {
          method: "DELETE",
        }),
        { memoryId: routeMemoryId },
      ),
    );

    expect(response.status).toBe(204);
    await expect(access(join(config.storePath, "memories", routeMemoryId))).rejects
      .toThrow();

    const verifyConnection = initializeDatabase(config);
    try {
      expect(verifyConnection.sqlite.prepare("select count(*) as count from memories").get())
        .toEqual({ count: 0 });
      expect(verifyConnection.sqlite.prepare("select count(*) as count from flashbacks").get())
        .toEqual({ count: 0 });
      expect(verifyConnection.sqlite.prepare("select count(*) as count from moments").get())
        .toEqual({ count: 0 });
      expect(verifyConnection.sqlite.prepare("select count(*) as count from memory_tags").get())
        .toEqual({ count: 0 });
      expect(verifyConnection.sqlite.prepare("select count(*) as count from memory_categories").get())
        .toEqual({ count: 0 });
      expect(verifyConnection.sqlite.prepare("select count(*) as count from tags").get())
        .toEqual({ count: 1 });
      expect(verifyConnection.sqlite.prepare("select count(*) as count from categories").get())
        .toEqual({ count: 1 });
    } finally {
      verifyConnection.close();
    }
  });

  it("returns not found for missing memories", async () => {
    const root = await makeRoot();
    loadRouteConfig(await writeRouteConfig(root));

    const response = await DELETE(
      createApiEvent(
        new Request("http://localhost/api/memories/missing-memory", {
          method: "DELETE",
        }),
        { memoryId: "missing-memory" },
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "memory was not found" });
  });

  it("maps backup failsafe errors to stable JSON before deleting content", async () => {
    const root = await makeRoot();
    const configPath = await writeRouteConfig(root);
    const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
    rawConfig.backup.git.enabled = true;
    await writeFile(configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf8");
    const config = loadRouteConfig(configPath);
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

    const response = await DELETE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${routeMemoryId}`, {
          method: "DELETE",
        }),
        { memoryId: routeMemoryId },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Backup location changed",
      backupFailsafe: {
        kind: "backup_path_drift",
      },
    });
    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).resolves.toContain("# Route Memory");
  });

  it("returns the active backup failsafe alert when synchronous delete backup fails", async () => {
    const root = await makeRoot();
    const configPath = await writeRouteConfig(root);
    const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
    const missingRemotePath = join(root, "missing.git");
    rawConfig.backup.git.enabled = true;
    rawConfig.backup.git.push = true;
    rawConfig.backup.git.commitMessageTemplate = "backup {action} {memoryId}";
    await writeFile(configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, "utf8");
    const config = loadRouteConfig(configPath);
    const localCommitConfig = {
      ...config,
      backup: {
        git: {
          ...config.backup.git,
          push: false,
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
    await runGitBackupJob({
      config: localCommitConfig,
      job: {
        memoryId: routeMemoryId,
        contentPaths: [`memories/${routeMemoryId}/CONTENT.md`],
        reason: "memory_creation",
      },
    });

    const response = await DELETE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${routeMemoryId}`, {
          method: "DELETE",
        }),
        { memoryId: routeMemoryId },
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "failed to delete memory",
      backupFailsafe: {
        kind: "backup_push_failed",
        gitRemoteUrl: missingRemotePath,
      },
    });
    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).resolves.toContain("# Route Memory");
  });

  it("rejects deletion when stored content path escapes store path", async () => {
    const root = await makeRoot();
    const config = loadRouteConfig(await writeRouteConfig(root));
    await seedRouteMemory(config, {
      contentPath: "../outside/CONTENT.md",
    });

    const response = await DELETE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${routeMemoryId}`, {
          method: "DELETE",
        }),
        { memoryId: routeMemoryId },
      ),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "failed to delete memory" });

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite
          .prepare("select count(*) as count from memories where id = ?")
          .get(routeMemoryId),
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }
  });

  it("does not read or return deleted content", async () => {
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
      markdown: "# Secret Local Content\n\nDo not return.",
    });

    const response = await DELETE(
      createApiEvent(
        new Request(`http://localhost/api/memories/${routeMemoryId}`, {
          method: "DELETE",
        }),
        { memoryId: routeMemoryId },
      ),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    await expect(
      readFile(join(config.storePath, "memories", routeMemoryId, "CONTENT.md"), "utf8"),
    ).rejects.toThrow();
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-delete-"));
  tempDirs.push(root);
  return root;
}

async function initializeGitRepository(projectPath: string): Promise<void> {
  await mkdir(projectPath, { recursive: true });
  git(projectPath, ["init", "--initial-branch=main"]);
  git(projectPath, ["config", "user.name", "Trauma Tests"]);
  git(projectPath, ["config", "user.email", "trauma@example.invalid"]);
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
