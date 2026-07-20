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
import { getBackupFailsafeAlertGeneration } from "../../../src/server/backup/failsafe-alert-generation";
import {
  ensureRuntimeProcessLease,
  runtimeLeaseInputsForConfig,
} from "../../../src/server/runtime/process-lease";
import {
  attachRuntimeRequestAdmission,
  releaseRuntimeRequestAdmission,
} from "../../../src/server/runtime/request-admission";

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
    let generation = "";
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
      const alert = await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
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
      generation = getBackupFailsafeAlertGeneration(alert);
    } finally {
      connection.close();
    }

    const response = await revert(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/revert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true, generation }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "revert" });
    const reloaded = loadTraumaConfig({ configPath });
    expect(reloaded.projectPath).toBe(join(root, "old-data"));
    expect(reloaded.storePath).toBe(join(root, "old-data/storage"));
  });

  it("returns a retryable conflict without rewriting config while another borrower is active", async () => {
    const root = await makeRoot();
    const configPath = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const generation = await seedPathDriftAlert(config, root);
    const lease = ensureRuntimeProcessLease(config);
    const independentBorrow = lease.borrow(runtimeLeaseInputsForConfig(config));
    const event = createApiEvent(
      new Request("http://localhost/api/backup/failsafe/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, generation }),
      }),
    );
    attachRuntimeRequestAdmission(event, lease);

    try {
      const response = await revert(event);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        restartRequired: false,
      });
      expect(loadTraumaConfig({ configPath }).projectPath).toBe(
        join(root, "new-data"),
      );
      expect(lease.admits(runtimeLeaseInputsForConfig(config))).toBe(true);
    } finally {
      independentBorrow.release();
      releaseRuntimeRequestAdmission(event);
      lease.release();
    }
  });

  it("releases its request and database borrows before suspending a root revert", async () => {
    const root = await makeRoot();
    const configPath = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const generation = await seedPathDriftAlert(config, root);
    const lease = ensureRuntimeProcessLease(config);
    const event = createApiEvent(
      new Request("http://localhost/api/backup/failsafe/revert", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, generation }),
      }),
    );
    attachRuntimeRequestAdmission(event, lease);

    try {
      const response = await revert(event);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        action: "revert",
        ok: true,
        restartRequired: true,
      });
      expect(loadTraumaConfig({ configPath }).projectPath).toBe(
        join(root, "old-data"),
      );
      expect(lease.admits(runtimeLeaseInputsForConfig(config))).toBe(false);
    } finally {
      releaseRuntimeRequestAdmission(event);
      lease.release();
    }
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

  it("requires an opaque alert generation with confirmation", async () => {
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
          body: JSON.stringify({ confirm: true }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "alert generation is required",
    });
  });

  it("rejects approval for an older active alert generation", async () => {
    const root = await makeRoot();
    const configPath = await writeTraumaConfig(root, {
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    let staleGeneration = "";
    try {
      const baseAlert = {
        id: "active" as const,
        kind: "backup_path_drift" as const,
        severity: "critical" as const,
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
      };
      const first = await connection.repositories.backupEnvironment
        .upsertBackupFailsafeAlert(baseAlert);
      staleGeneration = getBackupFailsafeAlertGeneration(first);
      const unchanged = await connection.repositories.backupEnvironment
        .upsertBackupFailsafeAlert({
          ...baseAlert,
          updatedAt: new Date(now.getTime() + 1),
        });
      expect(getBackupFailsafeAlertGeneration(unchanged)).toBe(
        staleGeneration,
      );
      const replacement = await connection.repositories.backupEnvironment
        .upsertBackupFailsafeAlert({
          ...baseAlert,
          message: "Backup location changed again",
          updatedAt: new Date(now.getTime() + 2),
        });
      expect(getBackupFailsafeAlertGeneration(replacement)).not.toBe(
        staleGeneration,
      );
    } finally {
      connection.close();
    }

    const response = await revert(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/revert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirm: true,
            generation: staleGeneration,
          }),
        }),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "backup failsafe alert changed while recovery was running; refresh and retry",
    });
    expect(loadTraumaConfig({ configPath }).projectPath).toBe(
      join(root, "new-data"),
    );
  });

  it("maps a stale or already-consumed failsafe action to conflict", async () => {
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
          body: JSON.stringify({
            confirm: true,
            generation: "0".repeat(64),
          }),
        }),
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "no active backup failsafe alert",
    });
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
    let generation = "";
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
      const alert = await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
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
      generation = getBackupFailsafeAlertGeneration(alert);
    } finally {
      connection.close();
    }

    const response = await deleteMissingRecord(
      createApiEvent(
        new Request("http://localhost/api/backup/failsafe/delete-missing-record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true, generation }),
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

async function seedPathDriftAlert(
  config: ReturnType<typeof loadTraumaConfig>,
  root: string,
) {
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
    const alert = await connection.repositories.backupEnvironment
      .upsertBackupFailsafeAlert({
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
    return getBackupFailsafeAlertGeneration(alert);
  } finally {
    connection.close();
  }
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
