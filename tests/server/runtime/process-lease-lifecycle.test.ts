import { randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Database } from "bun:sqlite";

import { describe, expect, it } from "vitest";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { resolveMemoryContentPath } from "../../../src/server/store/memory-content";
import {
  acquireDatabaseMigrationLease,
  acquireRuntimeProcessLease,
  ensureRuntimeProcessLease,
  ensureRuntimeProcessLeaseFromLoader,
  resolveRuntimeLeaseCoordinatorPath,
  resolveRuntimeProcessLeasePaths,
  reserveRuntimeProcessLeaseResources,
  runtimeLeaseInputsForConfig,
  suspendRuntimeStorageAdmissionIfIdle,
  RuntimeStorageBusyError,
  withRuntimeProcessLease,
} from "../../../src/server/runtime/process-lease";
import {
  createRuntimeConfig,
  expectRuntimeRejected,
  releaseLeaseOwner,
  spawnWorker,
  startLeaseOwner,
} from "./runtime-lease-test-helpers";

describe("runtime process lease lifecycle", () => {
  it("deduplicates identical effective resources into one lock", async () => {
    const { config } = await createRuntimeConfig();
    const sharedPath = join(dirname(config.databasePath), "shared");
    const plan = resolveRuntimeProcessLeasePaths({
      ...config,
      databasePath: sharedPath,
      projectPath: sharedPath,
      storePath: sharedPath,
    });

    expect(plan.resources).toHaveLength(4);
    expect(
      plan.resources.find((resource) =>
        resource.resourcePath.endsWith("/shared")
      )?.resourceLabels,
    ).toEqual(["databasePath", "projectPath", "storePath"]);
  });

  it("keeps coordinator state outside project and store backup scope", async () => {
    const { config } = await createRuntimeConfig();
    const coordinatorPath = resolveRuntimeLeaseCoordinatorPath();
    expect(relative(config.projectPath, coordinatorPath)).toMatch(/^\.\./);
    expect(relative(config.storePath, coordinatorPath)).toMatch(/^\.\./);
  });

  it("reuses process ownership across request bootstrap calls", async () => {
    const { config } = await createRuntimeConfig();
    const first = ensureRuntimeProcessLease(config);
    expect(ensureRuntimeProcessLease(config)).toBe(first);
    first.release();
  });

  it("does not reload config after middleware bootstrap succeeds", async () => {
    const { config } = await createRuntimeConfig();
    let loads = 0;
    const first = ensureRuntimeProcessLeaseFromLoader(() => {
      loads += 1;
      return config;
    });
    expect(
      ensureRuntimeProcessLeaseFromLoader(() => {
        throw new Error("steady-state loader must not run");
      }),
    ).toBe(first);
    expect(loads).toBe(1);
    first.release();
  });

  it("retries middleware bootstrap after a loader failure", async () => {
    const { config } = await createRuntimeConfig();
    let attempts = 0;
    expect(() =>
      ensureRuntimeProcessLeaseFromLoader(() => {
        attempts += 1;
        throw new Error("config temporarily unavailable");
      })
    ).toThrow("config temporarily unavailable");
    const lease = ensureRuntimeProcessLeaseFromLoader(() => {
      attempts += 1;
      return config;
    });
    expect(attempts).toBe(2);
    lease.release();
  });

  it("uses the OS account home instead of mutable HOME", () => {
    const originalHome = process.env.HOME;
    const before = resolveRuntimeLeaseCoordinatorPath();
    process.env.HOME = join(tmpdir(), "untrusted-home-override");
    try {
      expect(resolveRuntimeLeaseCoordinatorPath()).toBe(before);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it("fails closed on a malformed live coordinator root set", async () => {
    const { config } = await createRuntimeConfig();
    const bootstrap = acquireRuntimeProcessLease(config);
    bootstrap.release();
    const coordinatorPath = resolveRuntimeLeaseCoordinatorPath();
    const leaseId = randomUUID();
    const guardPath = join(dirname(coordinatorPath), "guards", `${leaseId}.sqlite`);
    await writeFile(guardPath, "", { mode: 0o600 });
    const guard = new Database(guardPath, { create: false, readwrite: true });
    guard.run("BEGIN EXCLUSIVE;");
    const coordinator = new Database(coordinatorPath, {
      create: false,
      readwrite: true,
    });
    try {
      coordinator
        .query(
          `INSERT INTO coordinator_leases (
            lease_id, owner_token, purpose, guard_path, root_set,
            display_resources, owner_pid, started_at
          ) VALUES (?1, ?2, 'runtime', ?3, ?4, ?5, ?6, ?7)`,
        )
        .run(
          leaseId,
          randomUUID(),
          guardPath,
          JSON.stringify({ schemaVersion: 2, resources: [] }),
          "[]",
          process.pid,
          new Date().toISOString(),
        );
      expect(() => acquireRuntimeProcessLease(config)).toThrow(/invalid root set/);
      expect(
        coordinator
          .query<{ count: number }, []>(
            "SELECT count(*) AS count FROM coordinator_leases",
          )
          .get()?.count,
      ).toBe(1);
    } finally {
      coordinator
        .query("DELETE FROM coordinator_leases WHERE lease_id = ?1")
        .run(leaseId);
      coordinator.close();
      guard.run("ROLLBACK;");
      guard.close();
      await rm(guardPath, { force: true });
      await rm(`${guardPath}-journal`, { force: true });
    }
  });

  it("uses the actual mixed-case database path for initialization locking", async () => {
    const { config } = await createRuntimeConfig();
    const directory = join(dirname(config.configFilePath), "MixedCaseRuntime");
    await mkdir(directory, { recursive: true });
    const lease = acquireDatabaseMigrationLease({
      ...config,
      databasePath: join(directory, "Trauma.sqlite"),
    });
    expect(
      lease.resources.find((resource) =>
        resource.resourcePath.endsWith("/Trauma.sqlite")
      )?.resourcePath,
    ).toBe(join(await realpath(directory), "Trauma.sqlite"));
    lease.release();
  });

  it("releases a command-scoped lease when its operation fails", async () => {
    const { config } = await createRuntimeConfig();
    await expect(
      withRuntimeProcessLease(config, () => {
        throw new Error("maintenance failed");
      }),
    ).rejects.toThrow("maintenance failed");
    const reacquired = acquireRuntimeProcessLease(config);
    reacquired.release();
  });

  it("holds both roots while storage admission awaits restart", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const previousConfig: ResolvedTraumaConfig = {
      ...config,
      configFilePath: join(root, "previous.config.json"),
      projectPath: join(root, "previous-project"),
      storePath: join(root, "previous-project", "store"),
    };
    const lease = ensureRuntimeProcessLease(config);
    const previousRoots = runtimeLeaseInputsForConfig(previousConfig).filter(
      ({ resourceLabel }) => resourceLabel !== "databasePath",
    );
    reserveRuntimeProcessLeaseResources(
      runtimeLeaseInputsForConfig(config),
      previousRoots,
    );
    expect(
      suspendRuntimeStorageAdmissionIfIdle(runtimeLeaseInputsForConfig(config)),
    ).toBe(true);
    expect(() => initializeDatabase(config, { runMigrations: false })).toThrow(
      /storage admission is suspended/,
    );
    const contenderConfig = {
      ...previousConfig,
      databasePath: join(root, "contender-runtime", "trauma.sqlite"),
    };
    await expectRuntimeRejected(config, /already active/);
    await expectRuntimeRejected(contenderConfig, /already active/);

    lease.release();
    const afterRestart = spawnWorker(contenderConfig, "once");
    await expect(afterRestart.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(afterRestart.nextStdout()).resolves.toMatchObject({ type: "initialized" });
    await expect(afterRestart.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(afterRestart.exit).resolves.toBe(0);
  });

  it("keeps admission active when an independent borrower blocks suspension", async () => {
    const { config } = await createRuntimeConfig();
    const resources = runtimeLeaseInputsForConfig(config);
    const lease = ensureRuntimeProcessLease(config);
    const independentBorrow = lease.borrow(resources);

    expect(() => suspendRuntimeStorageAdmissionIfIdle(resources)).toThrow(
      RuntimeStorageBusyError,
    );
    expect(lease.admits(resources)).toBe(true);
    const postFailureBorrow = lease.borrow(resources);
    postFailureBorrow.release();

    independentBorrow.release();
    expect(suspendRuntimeStorageAdmissionIfIdle(resources)).toBe(true);
    expect(lease.admits(resources)).toBe(false);
    expect(() => lease.borrow(resources)).toThrow(/storage admission is suspended/);
    lease.release();
  });

  it("reports that direct library use has no runtime admission to suspend", async () => {
    const { config } = await createRuntimeConfig();
    expect(
      suspendRuntimeStorageAdmissionIfIdle(runtimeLeaseInputsForConfig(config)),
    ).toBe(false);
  });

  it("fails expansion before changing ownership when a previous root is live", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const previousConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "previous-runtime", "trauma.sqlite"),
      projectPath: join(root, "previous-project"),
      storePath: join(root, "previous-project", "store"),
    };
    const previousOwner = await startLeaseOwner(previousConfig);
    const lease = ensureRuntimeProcessLease(config);
    const previousRoots = runtimeLeaseInputsForConfig(previousConfig).filter(
      ({ resourceLabel }) => resourceLabel !== "databasePath",
    );
    expect(() => lease.expand(previousRoots)).toThrow(/already active/);
    await expectRuntimeRejected(config, /databasePath|projectPath|storePath/);
    lease.release();
    await releaseLeaseOwner(previousOwner);
  });

  it("acquires current and additional roots as one initial union", async () => {
    const { config } = await createRuntimeConfig();
    const root = dirname(config.configFilePath);
    const previousConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "previous-runtime", "trauma.sqlite"),
      projectPath: join(root, "previous-project"),
      storePath: join(root, "previous-project", "store"),
    };
    const previousOwner = await startLeaseOwner(previousConfig);
    const previousRoots = runtimeLeaseInputsForConfig(previousConfig).filter(
      ({ resourceLabel }) => resourceLabel !== "databasePath",
    );
    expect(() => acquireRuntimeProcessLease(config, previousRoots)).toThrow(
      /already active/,
    );
    await releaseLeaseOwner(previousOwner);

    const union = acquireRuntimeProcessLease(config, previousRoots);
    await expectRuntimeRejected(previousConfig, /already active/);
    union.release();
  });

  it("rejects a changed runtime config before touching its database", async () => {
    const { config, configPath } = await createRuntimeConfig();
    const lease = ensureRuntimeProcessLease(config);
    const root = dirname(configPath);
    const changedDatabasePath = join(root, "changed-runtime", "trauma.sqlite");
    await writeFile(
      configPath,
      `${JSON.stringify({
        backup: config.backup,
        databasePath: changedDatabasePath,
        projectPath: join(root, "changed-project"),
        storePath: join(root, "changed-project", "store"),
      })}\n`,
      "utf8",
    );
    const previousConfigPath = process.env.TRAUMA_CONFIG_PATH;
    process.env.TRAUMA_CONFIG_PATH = configPath;
    try {
      expect(() => loadRuntimeTraumaConfig()).toThrow(
        /configuration changed.*restart TRAUMA/i,
      );
      expect(() => accessSync(changedDatabasePath)).toThrow();
      expect(
        resolveMemoryContentPath(
          { storePath: "." },
          "019f6bd2-a109-7733-ae11-d7d4b19e494c",
        ).relativePath,
      ).toBe("memories/019f6bd2-a109-7733-ae11-d7d4b19e494c/CONTENT.md");
    } finally {
      if (previousConfigPath === undefined) delete process.env.TRAUMA_CONFIG_PATH;
      else process.env.TRAUMA_CONFIG_PATH = previousConfigPath;
      lease.release();
    }
  });

  it("keeps a successor active when an old handle is released twice", async () => {
    const { config } = await createRuntimeConfig();
    const oldLease = acquireRuntimeProcessLease(config);
    oldLease.release();
    const successor = acquireRuntimeProcessLease(config);
    oldLease.release();
    await expectRuntimeRejected(config, /databasePath|projectPath|storePath/);
    successor.release();
  });
});
