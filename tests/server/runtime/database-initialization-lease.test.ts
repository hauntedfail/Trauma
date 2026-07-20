import { accessSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import { describe, expect, it, vi } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import {
  acquireDatabaseInitializationLease,
  acquireRuntimeProcessLease,
  resolveRuntimeLeaseCoordinatorPath,
  runtimeLeaseInputsForConfig,
  withRuntimeProcessLease,
} from "../../../src/server/runtime/process-lease";
import {
  createRuntimeConfig,
  expectRuntimeRejected,
  releaseLeaseOwner,
  spawnInitializationLeaseWorker,
  spawnMigrationWorker,
  spawnRuntimeCloseFailureWorker,
  spawnWorker,
  startLeaseOwner,
} from "./runtime-lease-test-helpers";

describe("database initialization lease", () => {
  it("fails immediately behind a live runtime before creating a missing database", async () => {
    const { config } = await createRuntimeConfig();
    const owner = await startLeaseOwner(config);
    const contender = spawnMigrationWorker(config, { runMigrations: false });
    await expect(contender.nextStdout()).resolves.toMatchObject({ type: "ready" });
    const started = Date.now();
    contender.send("initialize");
    await expect(contender.nextStderr()).resolves.toMatchObject({
      message: expect.stringContaining("already active"),
      type: "error",
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(contender.exit).resolves.not.toBe(0);
    expect(() => accessSync(config.databasePath)).toThrow();
    await releaseLeaseOwner(owner);
  });

  it("blocks a runtime while standalone initialization owns the database", async () => {
    const { config } = await createRuntimeConfig();
    const owner = spawnInitializationLeaseWorker(config);
    await expect(owner.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expectRuntimeRejected(config, /already active/);
    owner.send("release");
    await expect(owner.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(owner.exit).resolves.toBe(0);
  });

  it("recovers stale initialization ownership after its process exits", async () => {
    const { config } = await createRuntimeConfig();
    const owner = spawnInitializationLeaseWorker(config, {
      exitWithoutRelease: true,
    });
    await expect(owner.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(owner.exit).resolves.toBe(0);
    expect(countCoordinatorRows("migration")).toBe(1);

    const successor = acquireRuntimeProcessLease(config);
    successor.release();
    expect(countCoordinatorRows("migration")).toBe(0);
  });

  it("recovers stale runtime ownership after its process exits", async () => {
    const { config } = await createRuntimeConfig();
    const owner = spawnWorker(config, "exit-without-release");
    await expect(owner.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    await expect(owner.exit).resolves.toBe(0);
    expect(countCoordinatorRows("runtime")).toBe(1);

    const successor = acquireDatabaseInitializationLease(config);
    successor.release();
    expect(countCoordinatorRows("runtime")).toBe(0);
  });

  it("waits on one existing initialization guard without creating retry guards", async () => {
    const { config } = await createRuntimeConfig();
    const first = spawnInitializationLeaseWorker(config);
    await expect(first.nextStdout()).resolves.toMatchObject({ type: "acquired" });
    const guardDirectory = join(dirname(resolveRuntimeLeaseCoordinatorPath()), "guards");
    expect(readdirSync(guardDirectory).filter((name) => name.endsWith(".sqlite"))).toHaveLength(1);

    const second = spawnInitializationLeaseWorker(config);
    const secondEvent = second.nextStdout();
    const early = await Promise.race([
      secondEvent.then(() => "acquired" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 150)),
    ]);
    expect(early).toBe("blocked");
    expect(readdirSync(guardDirectory).filter((name) => name.endsWith(".sqlite"))).toHaveLength(1);

    first.send("release");
    await expect(first.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(first.exit).resolves.toBe(0);
    await expect(secondEvent).resolves.toMatchObject({ type: "acquired" });
    second.send("release");
    await expect(second.nextStdout()).resolves.toMatchObject({ type: "released" });
    await expect(second.exit).resolves.toBe(0);
  });

  it("serializes hardlink and symlink aliases through canonical identities", async () => {
    const { config, root } = await createRuntimeConfig();
    await mkdir(dirname(config.databasePath), { recursive: true });
    await writeFile(config.databasePath, "");
    const aliasDirectory = join(root, "alias-runtime");
    await mkdir(aliasDirectory);
    const hardlinkPath = join(aliasDirectory, "hardlink.sqlite");
    await link(config.databasePath, hardlinkPath);
    const hardlinkConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: hardlinkPath,
      projectPath: join(root, "hardlink-project"),
      storePath: join(root, "hardlink-project", "store"),
    };
    await expectBlockedUntilRelease(config, hardlinkConfig);

    const view = join(root, "runtime-view");
    await symlink(dirname(config.databasePath), view, "dir");
    const symlinkConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(view, "trauma.sqlite"),
      projectPath: join(root, "symlink-project"),
      storePath: join(root, "symlink-project", "store"),
    };
    await expectBlockedUntilRelease(config, symlinkConfig);
  });

  it("retains standalone ownership until the returned connection closes", async () => {
    const { config } = await createRuntimeConfig();
    const connection = initializeDatabase(config, { runMigrations: false });
    await expectRuntimeRejected(config, /already active/);
    connection.close();
    connection.close();

    const afterClose = acquireRuntimeProcessLease(config);
    afterClose.release();
  });

  it("shares standalone ownership until every same-path connection closes", async () => {
    const { config } = await createRuntimeConfig();
    const first = initializeDatabase(config, { runMigrations: false });
    const second = initializeDatabase(config, { runMigrations: false });
    await expectRuntimeRejected(config, /already active/);

    first.close();
    await expectRuntimeRejected(config, /already active/);

    second.close();
    const afterBothClose = acquireRuntimeProcessLease(config);
    afterBothClose.release();
  });

  it("keeps standalone ownership when SQLite close fails and permits a retry", async () => {
    const { config } = await createRuntimeConfig();
    const connection = initializeDatabase(config, { runMigrations: false });
    const originalClose = connection.sqlite.close.bind(connection.sqlite);
    const close = vi.spyOn(connection.sqlite, "close")
      .mockImplementationOnce(() => {
        throw new Error("injected close failure");
      })
      .mockImplementation(originalClose);

    expect(() => connection.close()).toThrow(/injected close failure/);
    await expectRuntimeRejected(config, /already active/);
    connection.close();
    expect(close).toHaveBeenCalledTimes(2);

    const afterRetry = acquireRuntimeProcessLease(config);
    afterRetry.release();
  });

  it("retries standalone ownership release without closing SQLite twice", async () => {
    const { config } = await createRuntimeConfig();
    const connection = initializeDatabase(config, { runMigrations: false });
    const row = readCoordinatorOwner("migration");
    expect(row).toBeDefined();
    updateCoordinatorOwnerToken(row!.leaseId, randomUUID());
    const close = vi.spyOn(connection.sqlite, "close");

    expect(() => connection.close()).toThrow(/lost its exact lease row/);
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => acquireDatabaseInitializationLease(config)).toThrow(
      /ownership release is pending/,
    );

    updateCoordinatorOwnerToken(row!.leaseId, row!.ownerToken);
    connection.close();
    expect(close).toHaveBeenCalledTimes(1);
    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("keeps a scoped runtime guard after owner release until SQLite closes", async () => {
    const { config } = await createRuntimeConfig();
    let connection: ReturnType<typeof initializeDatabase> | undefined;
    await expect(
      withRuntimeProcessLease(config, () => {
        connection = initializeDatabase(config, { runMigrations: false });
        const originalClose = connection.sqlite.close.bind(connection.sqlite);
        vi.spyOn(connection.sqlite, "close")
          .mockImplementationOnce(() => {
            throw new Error("injected runtime close failure");
          })
          .mockImplementation(originalClose);
        connection.close();
      }),
    ).rejects.toThrow(/injected runtime close failure/);

    await expectRuntimeRejected(config, /already active/);
    connection!.close();
    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("retries runtime ownership release without closing SQLite twice", async () => {
    const { config } = await createRuntimeConfig();
    const owner = acquireRuntimeProcessLease(config);
    const connection = initializeDatabase(config, { runMigrations: false });
    const row = readCoordinatorOwner("runtime");
    expect(row).toBeDefined();
    updateCoordinatorOwnerToken(row!.leaseId, randomUUID());
    const close = vi.spyOn(connection.sqlite, "close");

    owner.release();
    try {
      expect(() => connection.close()).toThrow(/lost its exact lease row/);
      expect(close).toHaveBeenCalledTimes(1);
      await expectRuntimeRejected(config, /already active/);
    } finally {
      updateCoordinatorOwnerToken(row!.leaseId, row!.ownerToken);
    }
    connection.close();
    expect(close).toHaveBeenCalledTimes(1);
    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("strongly retains a failed runtime borrow until its process exits", async () => {
    const { config } = await createRuntimeConfig();
    const owner = spawnRuntimeCloseFailureWorker(config);
    await expect(owner.nextStdout()).resolves.toMatchObject({
      type: "failed-retained",
    });
    await expectRuntimeRejected(config, /already active/);

    owner.send("exit");
    await expect(owner.exit).resolves.toBe(0);
    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("rejects an overlapping alias inside one process instead of sharing ownership", async () => {
    const { config, root } = await createRuntimeConfig();
    await mkdir(dirname(config.databasePath), { recursive: true });
    await writeFile(config.databasePath, "");
    const owner = acquireDatabaseInitializationLease(config);
    const alias = join(root, "same-process-alias.sqlite");
    await link(config.databasePath, alias);
    expect(() =>
      acquireDatabaseInitializationLease({
        ...config,
        databasePath: alias,
      })
    ).toThrow(/overlapping database family/);
    owner.release();
  });

  it("refreshes WAL sidecar identities before admitting a hardlink alias", async () => {
    const { config, root } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const connection = initializeDatabase(config, { runMigrations: false });
    const sidecar = [`${config.databasePath}-wal`, `${config.databasePath}-shm`]
      .find((path) => {
        try {
          accessSync(path);
          return true;
        } catch {
          return false;
        }
      });
    expect(sidecar).toBeDefined();
    const alias = join(root, "sidecar-as-database.sqlite");
    await link(sidecar!, alias);
    try {
      await expectRuntimeRejected(
        {
          ...config,
          databasePath: alias,
          projectPath: join(root, "other-project"),
          storePath: join(root, "other-project", "store"),
        },
        /databasePath=/,
      );
    } finally {
      await rm(alias, { force: true });
      connection.close();
      lease.release();
    }
  });

  it("does not admit reserved-only roots for a nonpersistent command lease", async () => {
    const { config, root } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const reservedConfig: ResolvedTraumaConfig = {
      ...config,
      databasePath: join(root, "reserved-runtime", "trauma.sqlite"),
      projectPath: join(root, "reserved-project"),
      storePath: join(root, "reserved-project", "store"),
    };
    lease.expand(runtimeLeaseInputsForConfig(reservedConfig));
    expect(() => initializeDatabase(reservedConfig, { runMigrations: false })).toThrow(
      /configuration changed/,
    );
    expect(() => accessSync(reservedConfig.databasePath)).toThrow();
    lease.release();
  });
});

async function expectBlockedUntilRelease(
  ownerConfig: ResolvedTraumaConfig,
  contenderConfig: ResolvedTraumaConfig,
) {
  const owner = acquireDatabaseInitializationLease(ownerConfig);
  const contender = spawnMigrationWorker(contenderConfig);
  await expect(contender.nextStdout()).resolves.toMatchObject({ type: "ready" });
  contender.send("initialize");
  const event = contender.nextStdout();
  const early = await Promise.race([
    event.then(() => "initialized" as const),
    new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
  ]);
  expect(early).toBe("blocked");
  owner.release();
  await expect(event).resolves.toMatchObject({ type: "initialized" });
  await expect(contender.exit).resolves.toBe(0);
}

function countCoordinatorRows(purpose: "migration" | "runtime"): number {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  try {
    return database
      .query<{ count: number }, [string]>(
        "SELECT count(*) AS count FROM coordinator_leases WHERE purpose = ?1",
      )
      .get(purpose)?.count ?? 0;
  } finally {
    database.close();
  }
}

function readCoordinatorOwner(
  purpose: "migration" | "runtime",
): { leaseId: string; ownerToken: string } | undefined {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  try {
    return database
      .query<
        { leaseId: string; ownerToken: string },
        ["migration" | "runtime"]
      >(
        `SELECT lease_id AS leaseId, owner_token AS ownerToken
         FROM coordinator_leases WHERE purpose = ?1`,
      )
      .get(purpose) ?? undefined;
  } finally {
    database.close();
  }
}

function updateCoordinatorOwnerToken(leaseId: string, ownerToken: string): void {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  try {
    database
      .query("UPDATE coordinator_leases SET owner_token = ?1 WHERE lease_id = ?2")
      .run(ownerToken, leaseId);
  } finally {
    database.close();
  }
}
