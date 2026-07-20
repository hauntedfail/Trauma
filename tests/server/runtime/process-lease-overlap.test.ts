import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBackupFailsafeCli } from "../../../scripts/trauma-backup-failsafe";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { acquireRuntimeProcessLease } from "../../../src/server/runtime/process-lease";
import {
  createRuntimeConfig,
  expectRuntimeRejected,
  releaseLeaseOwner,
  spawnMiddlewareWorker,
  spawnMigrationWorker,
  spawnWorker,
  startLeaseOwner,
} from "./runtime-lease-test-helpers";

describe("runtime process lease overlap", () => {
  it("serializes direct cross-process migrations without corrupting an empty database", async () => {
    const { config } = await createRuntimeConfig();
    const secondConfig: ResolvedTraumaConfig = {
      ...config,
      projectPath: join(dirname(config.projectPath), "migration-project-two"),
      storePath: join(
        dirname(config.projectPath),
        "migration-project-two",
        "store",
      ),
    };
    const first = spawnMigrationWorker(config);
    const second = spawnMigrationWorker(secondConfig);

    await expect(first.nextStdout()).resolves.toMatchObject({ type: "ready" });
    await expect(second.nextStdout()).resolves.toMatchObject({ type: "ready" });
    first.send("initialize");
    second.send("initialize");

    const [firstInitialized, secondInitialized] = await Promise.all([
      first.nextStdout(),
      second.nextStdout(),
    ]);
    expect(firstInitialized).toMatchObject({ type: "initialized" });
    expect(secondInitialized).toEqual(firstInitialized);
    expect(firstInitialized.migrations).toBeGreaterThan(0);
    await expect(first.exit).resolves.toBe(0);
    await expect(second.exit).resolves.toBe(0);
  });

  it("rejects a second runtime that shares only databasePath", async () => {
    const { config } = await createRuntimeConfig();
    const owner = await startLeaseOwner(config);
    const contenderConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(dirname(config.configFilePath), "other.config.json"),
      projectPath: join(dirname(config.projectPath), "other-project"),
      storePath: join(dirname(config.projectPath), "other-project", "store"),
    };

    await expectRuntimeRejected(contenderConfig, /databasePath=/);
    await releaseLeaseOwner(owner);
  });

  it("rejects a second runtime that shares only storePath", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const sharedStorePath = join(root, "shared-project", "nested", "store");
    const ownerConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "runtime-owner", "trauma.sqlite"),
      projectPath: join(root, "shared-project"),
      storePath: sharedStorePath,
    };
    const contenderConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "other.config.json"),
      databasePath: join(root, "runtime-contender", "trauma.sqlite"),
      projectPath: join(root, "shared-project", "nested"),
      storePath: sharedStorePath,
    };
    const owner = await startLeaseOwner(ownerConfig);

    await expectRuntimeRejected(contenderConfig, /storePath=/);
    await releaseLeaseOwner(owner);
  });

  it("rejects ancestor and descendant project resources in either ownership order", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const parentConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "parent.config.json"),
      databasePath: join(root, "parent-runtime", "trauma.sqlite"),
      projectPath: join(root, "shared-project"),
      storePath: join(root, "shared-project", "store"),
    };
    const childConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "child.config.json"),
      databasePath: join(root, "child-runtime", "trauma.sqlite"),
      projectPath: join(root, "shared-project", "nested"),
      storePath: join(root, "shared-project", "nested", "store"),
    };

    const parentOwner = await startLeaseOwner(parentConfig);
    await expectRuntimeRejected(childConfig, /projectPath=/);
    await releaseLeaseOwner(parentOwner);

    const childOwner = await startLeaseOwner(childConfig);
    await expectRuntimeRejected(parentConfig, /projectPath=/);
    await releaseLeaseOwner(childOwner);
  });

  it("rejects missing-path case aliases on case-folding platforms", async () => {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      return;
    }
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const ownerConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "owner-runtime", "trauma.sqlite"),
      projectPath: join(root, "missing-project"),
      storePath: join(root, "missing-project", "store"),
    };
    const aliasConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "alias.config.json"),
      databasePath: join(root, "alias-runtime", "trauma.sqlite"),
      projectPath: join(root, "MISSING-PROJECT"),
      storePath: join(root, "MISSING-PROJECT", "STORE"),
    };
    const owner = await startLeaseOwner(ownerConfig);

    await expectRuntimeRejected(aliasConfig, /projectPath=|storePath=/);
    await releaseLeaseOwner(owner);
  });

  it("rejects the same resource through a different symlink view", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const physicalRoot = join(root, "physical-volume");
    const aliasRoot = join(root, "mounted-alias");
    await mkdir(physicalRoot, { recursive: true });
    await symlink(physicalRoot, aliasRoot, "dir");
    const ownerConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "owner-runtime", "trauma.sqlite"),
      projectPath: join(physicalRoot, "project"),
      storePath: join(physicalRoot, "project", "store"),
    };
    const aliasConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "alias.config.json"),
      databasePath: join(root, "alias-runtime", "trauma.sqlite"),
      projectPath: join(aliasRoot, "project"),
      storePath: join(aliasRoot, "project", "store"),
    };
    const owner = await startLeaseOwner(ownerConfig);

    await expectRuntimeRejected(aliasConfig, /projectPath=|storePath=/);
    await releaseLeaseOwner(owner);
  });

  it("allows disjoint sibling resource trees to coexist", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const leftConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "left.config.json"),
      databasePath: join(root, "left-runtime", "trauma.sqlite"),
      projectPath: join(root, "shared-parent", "left"),
      storePath: join(root, "shared-parent", "left", "store"),
    };
    const rightConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "right.config.json"),
      databasePath: join(root, "right-runtime", "trauma.sqlite"),
      projectPath: join(root, "shared-parent", "right"),
      storePath: join(root, "shared-parent", "right", "store"),
    };
    const leftOwner = await startLeaseOwner(leftConfig);

    const right = spawnWorker(rightConfig, "once");
    await expect(right.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(right.nextStdout()).resolves.toMatchObject({ type: "initialized" });
    await expect(right.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(right.exit).resolves.toBe(0);
    await releaseLeaseOwner(leftOwner);
  });

  it("allows fully disjoint runtime resources to coexist", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const owner = await startLeaseOwner(config);
    const disjointConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "disjoint.config.json"),
      databasePath: join(root, "disjoint-runtime", "trauma.sqlite"),
      projectPath: join(root, "disjoint-project"),
      storePath: join(root, "disjoint-project", "store"),
    };

    const disjoint = spawnWorker(disjointConfig, "once");
    await expect(disjoint.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(disjoint.nextStdout()).resolves.toMatchObject({ type: "initialized" });
    await expect(disjoint.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(disjoint.exit).resolves.toBe(0);
    await releaseLeaseOwner(owner);
  });

  it("requires the exact dev-smoke signals before middleware bypass", async () => {
    const { config } = await createRuntimeConfig();
    const owner = await startLeaseOwner(config);

    const browseOnly = spawnMiddlewareWorker(config, {
      HOST: "127.0.0.1",
      TRAUMA_BROWSE_FIXTURES: "1",
      TRAUMA_CONFIG_PATH: config.configFilePath,
    });
    await expect(browseOnly.nextStderr()).resolves.toMatchObject({
      message: expect.stringContaining("already active"),
      type: "error",
    });
    await expect(browseOnly.exit).resolves.not.toBe(0);

    const smokeFixture = spawnMiddlewareWorker(config, {
      HOST: "127.0.0.1",
      TRAUMA_BROWSE_FIXTURES: "1",
      TRAUMA_CONFIG_PATH: "",
      TRAUMA_DATABASE_PATH: "",
      TRAUMA_RUNTIME_FIXTURE_CONTEXT: "dev-smoke-v1",
    });
    await expect(smokeFixture.nextStdout()).resolves.toMatchObject({
      type: "fixture-bypassed",
    });
    await expect(smokeFixture.exit).resolves.toBe(0);

    const mutation = spawnMiddlewareWorker(config, {
      HOST: "127.0.0.1",
      TRAUMA_BROWSE_FIXTURES: "1",
      TRAUMA_CONFIG_PATH: "",
      TRAUMA_DATABASE_PATH: "",
      TRAUMA_RUNTIME_FIXTURE_CONTEXT: "dev-smoke-v1",
      TRAUMA_TEST_REQUEST_METHOD: "POST",
      TRAUMA_TEST_REQUEST_PATH: "/api/memories",
    });
    await expect(mutation.nextStderr()).resolves.toMatchObject({
      message: expect.stringContaining("already active"),
      type: "error",
    });
    await expect(mutation.exit).resolves.not.toBe(0);
    await releaseLeaseOwner(owner);
  });

  it("does not publish partial ownership when composite acquisition fails", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const ownerConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "z-holder.sqlite"),
      projectPath: join(root, "z-project"),
      storePath: join(root, "z-project", "store"),
    };
    const owner = await startLeaseOwner(ownerConfig);
    const firstResourcePath = join(root, "a-first.sqlite");
    const partialConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: firstResourcePath,
      projectPath: ownerConfig.projectPath,
      storePath: join(ownerConfig.projectPath, "other-store"),
    };
    expect(() => acquireRuntimeProcessLease(partialConfig)).toThrow(/projectPath=/);

    const probe = acquireRuntimeProcessLease({
      ...config,
      databasePath: firstResourcePath,
      projectPath: join(root, "probe-project"),
      storePath: join(root, "probe-project", "store"),
    });
    probe.release();
    await releaseLeaseOwner(owner);
  });

  it("blocks startup and maintenance until the runtime releases", async () => {
    const { config, configPath } = await createRuntimeConfig();
    const owner = spawnWorker(config, "hold");
    await expect(owner.nextStdout()).resolves.toMatchObject({ type: "acquired" });

    await expectRuntimeRejected(config, /already active/);
    await expect(
      runBackupFailsafeCli(["status", "--config", configPath]),
    ).rejects.toThrow(/already active/);

    owner.send("initialize");
    const initialized = await owner.nextStdout();
    expect(initialized).toMatchObject({ type: "initialized" });
    owner.send("release");
    await expect(owner.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(owner.exit).resolves.toBe(0);

    const restarted = spawnWorker(config, "once");
    await expect(restarted.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(restarted.nextStdout()).resolves.toEqual(initialized);
    await expect(restarted.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(restarted.exit).resolves.toBe(0);
  });

  it("reserves previous failsafe roots before migration reads them", async () => {
    const { config, configPath } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const previousConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "previous.config.json"),
      databasePath: join(root, "previous-runtime", "trauma.sqlite"),
      projectPath: join(root, "previous-project"),
      storePath: join(root, "previous-project", "store"),
    };
    const connection = initializeDatabase(config);
    try {
      const now = new Date("2026-07-21T00:00:00.000Z");
      await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
        id: "active",
        kind: "backup_path_drift",
        severity: "critical",
        message: "Backup location changed",
        previousProjectPath: previousConfig.projectPath,
        previousStorePath: previousConfig.storePath,
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
    const previousOwner = await startLeaseOwner(previousConfig);

    try {
      await expect(
        runBackupFailsafeCli(["migrate", "--config", configPath]),
      ).rejects.toThrow(/already active/);
    } finally {
      await releaseLeaseOwner(previousOwner);
    }
  });

  it("blocks the migration CLI before database side effects until the runtime releases", async () => {
    const { config, configPath } = await createRuntimeConfig();
    const owner = await startLeaseOwner(config);

    expect(existsSync(config.databasePath)).toBe(false);
    const blocked = runMigrationCli(configPath);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("already active");
    expect(existsSync(config.databasePath)).toBe(false);

    await releaseLeaseOwner(owner);

    const migrated = runMigrationCli(configPath);
    expect(migrated.status).toBe(0);
    expect(migrated.stdout).toContain(
      `Applied runtime migrations to ${config.databasePath}`,
    );
    expect(existsSync(config.databasePath)).toBe(true);
  });

  it("recovers after an owner process crashes", async () => {
    const { config } = await createRuntimeConfig();
    const crashedOwner = spawnWorker(config, "lease-only-hold");
    await expect(crashedOwner.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    crashedOwner.kill("SIGKILL");
    await expect(crashedOwner.exit).resolves.not.toBe(0);

    const recovered = spawnWorker(config, "once");
    await expect(recovered.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(recovered.nextStdout()).resolves.toMatchObject({ type: "initialized" });
    await expect(recovered.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(recovered.exit).resolves.toBe(0);
  });
});

function runMigrationCli(configPath: string) {
  return spawnSync(
    process.execPath,
    ["run", "scripts/migrate-database.ts", "--config", configPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );
}
