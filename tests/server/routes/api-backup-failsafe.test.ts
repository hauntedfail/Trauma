import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import { POST as migrate } from "../../../src/routes/api/backup/failsafe/migrate";
import { POST as revert } from "../../../src/routes/api/backup/failsafe/revert";
import { POST as deleteMissingRecord } from "../../../src/routes/api/backup/failsafe/delete-missing-record";
import { initializeDatabase } from "../../../src/server/db";
import { loadTraumaConfig } from "../../../src/server/config";

const tempDirs: string[] = [];
const previousConfigPath = process.env.TRAUMA_CONFIG_PATH;
const now = new Date("2026-05-13T00:00:00.000Z");

afterEach(async () => {
  restoreConfigPath();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("backup failsafe API routes", () => {
  it("requires explicit confirmation before reverting config", async () => {
    const root = await makeRoot();
    process.env.TRAUMA_CONFIG_PATH = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });

    const response = await revert(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/revert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: false }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "confirmation is required" });
  });

  it("reverts config to the previous stamped backup paths", async () => {
    const root = await makeRoot();
    const configPath = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: join(root, "old-data"),
        storePath: join(root, "old-data/storage"),
        gitRemote: "origin",
        gitRemoteUrl: null,
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
      await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
        id: "active",
        kind: "backup_path_drift",
        severity: "critical",
        message: "Backup location changed",
        previousProjectPath: join(root, "old-data"),
        previousStorePath: join(root, "old-data/storage"),
        currentProjectPath: config.projectPath,
        currentStorePath: config.storePath,
        gitRemote: "origin",
        gitRemoteUrl: null,
        gitBranch: "main",
        error: null,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    const response = await revert(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/revert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "revert" });
    const reloaded = loadTraumaConfig({ configPath });
    expect(reloaded.projectPath).toBe(join(root, "old-data"));
    expect(reloaded.storePath).toBe(join(root, "old-data/storage"));
  });

  it("requires explicit confirmation before migrating backup content", async () => {
    const root = await makeRoot();
    process.env.TRAUMA_CONFIG_PATH = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });

    const response = await migrate(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/migrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: false }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "confirmation is required" });
  });

  it("rejects cross-origin simple failsafe confirmations before loading config", async () => {
    const response = await migrate(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/migrate", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "text/plain",
          },
          body: JSON.stringify({ confirm: true }),
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "same-origin request is required",
    });
  });

  it("deletes missing content memory records through the recovery API", async () => {
    const root = await makeRoot();
    const configPath = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.memories.create({
        id: "memory-missing",
        url: "https://example.com/missing",
        title: "Missing content",
        description: null,
        faviconUrl: null,
        contentPath: "memories/memory-missing/CONTENT.md",
        extractionStatus: "success",
        extractionError: null,
        backupStatus: "success",
        lastBackupAt: now,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: config.projectPath,
        storePath: config.storePath,
        gitRemote: "origin",
        gitRemoteUrl: null,
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
      await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
        id: "active",
        kind: "backup_content_inconsistent",
        severity: "critical",
        message: "Backup content is inconsistent",
        previousProjectPath: null,
        previousStorePath: null,
        currentProjectPath: config.projectPath,
        currentStorePath: config.storePath,
        gitRemote: "origin",
        gitRemoteUrl: null,
        gitBranch: "main",
        error:
          "successful backup content is missing or untracked: memoryId=memory-missing, reason=missing_file",
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }

    const response = await deleteMissingRecord(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/delete-missing-record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      action: "delete-missing-record",
    });
    const check = initializeDatabase(config);
    try {
      expect(await check.repositories.memories.findById("memory-missing"))
        .toBeUndefined();
      expect(await check.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
    } finally {
      check.close();
    }
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-backup-failsafe-"));
  tempDirs.push(root);
  return root;
}

async function writeTraumaConfig(
  root: string,
  input: { projectPath: string; storePath: string },
) {
  const configPath = join(root, "trauma.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        storePath: input.storePath,
        projectPath: input.projectPath,
        databasePath: "./.trauma/trauma.sqlite",
        backup: {
          git: {
            enabled: true,
            remote: "origin",
            branch: "main",
            push: false,
            commitMessageTemplate: "backup memory {memoryId}",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return configPath;
}

function createApiEvent(request: Request): APIEvent {
  return {
    request,
    params: {},
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}

function restoreConfigPath() {
  if (previousConfigPath === undefined) {
    delete process.env.TRAUMA_CONFIG_PATH;
    return;
  }

  process.env.TRAUMA_CONFIG_PATH = previousConfigPath;
}
