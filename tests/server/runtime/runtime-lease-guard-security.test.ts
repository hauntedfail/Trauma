import { randomUUID } from "node:crypto";
import { accessSync, chmodSync } from "node:fs";
import { chmod, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import { describe, expect, it } from "vitest";

import {
  acquireDatabaseInitializationLease,
  acquireRuntimeProcessLease,
  resolveRuntimeLeaseCoordinatorPath,
  resolveRuntimeProcessLeasePaths,
} from "../../../src/server/runtime/process-lease";
import {
  createBoundGuard,
  deleteCoordinatorRow,
  insertCoordinatorRow,
} from "./runtime-lease-security-test-helpers";
import { createRuntimeConfig } from "./runtime-lease-test-helpers";

describe("runtime lease guard security", () => {
  it("validates corrupt rows before touching their recorded guard", async () => {
    const { config, root } = await createRuntimeConfig();
    const bootstrap = acquireRuntimeProcessLease(config);
    bootstrap.release();
    const leaseId = randomUUID();
    const target = join(root, "target.sqlite");
    await writeFile(target, "", { mode: 0o600 });
    const guardPath = join(
      dirname(resolveRuntimeLeaseCoordinatorPath()),
      "guards",
      `${leaseId}.sqlite`,
    );
    await symlink(target, guardPath);
    const database = new Database(resolveRuntimeLeaseCoordinatorPath());
    database
      .query(
        `INSERT INTO coordinator_leases (
          lease_id, owner_token, purpose, guard_path, root_set,
          display_resources, owner_pid, started_at
        ) VALUES (?1, ?2, 'runtime', ?3, ?4, '[]', ?5, ?6)`,
      )
      .run(
        leaseId,
        randomUUID(),
        guardPath,
        JSON.stringify({ resources: [], schemaVersion: 2 }),
        process.pid,
        new Date().toISOString(),
      );
    try {
      expect(() => acquireRuntimeProcessLease(config)).toThrow(/invalid root set/);
    } finally {
      database
        .query("DELETE FROM coordinator_leases WHERE lease_id = ?1")
        .run(leaseId);
      database.close();
      await rm(guardPath, { force: true });
    }
  });

  it("rejects permissive guards and stale guards with mismatched owner binding", async () => {
    const { config } = await createRuntimeConfig();
    const bootstrap = acquireRuntimeProcessLease(config);
    bootstrap.release();
    const plan = resolveRuntimeProcessLeasePaths(config);

    const permissiveId = randomUUID();
    const permissiveToken = randomUUID();
    const permissivePath = await createBoundGuard(permissiveId, permissiveToken);
    await chmod(permissivePath, 0o644);
    insertCoordinatorRow(plan, permissiveId, permissiveToken, permissivePath);
    try {
      expect(() => acquireRuntimeProcessLease(config)).toThrow(
        /owner-only regular file/,
      );
    } finally {
      deleteCoordinatorRow(permissiveId);
      chmodSync(permissivePath, 0o600);
      await rm(permissivePath, { force: true });
    }

    const mismatchId = randomUUID();
    const expectedToken = randomUUID();
    const mismatchPath = await createBoundGuard(mismatchId, randomUUID());
    insertCoordinatorRow(plan, mismatchId, expectedToken, mismatchPath);
    try {
      expect(() => acquireRuntimeProcessLease(config)).toThrow(/not bound/);
    } finally {
      deleteCoordinatorRow(mismatchId);
      await rm(mismatchPath, { force: true });
    }
  });

  it("prioritizes a live runtime over migration rows regardless of row order", async () => {
    const { config } = await createRuntimeConfig();
    const bootstrap = acquireRuntimeProcessLease(config);
    bootstrap.release();
    const plan = resolveRuntimeProcessLeasePaths(config);
    const migrationId = randomUUID();
    const runtimeId = randomUUID();
    const migrationToken = randomUUID();
    const runtimeToken = randomUUID();
    const migrationPath = await createBoundGuard(migrationId, migrationToken);
    const runtimePath = await createBoundGuard(runtimeId, runtimeToken);
    insertCoordinatorRow(
      plan,
      migrationId,
      migrationToken,
      migrationPath,
      "migration",
    );
    insertCoordinatorRow(plan, runtimeId, runtimeToken, runtimePath, "runtime");
    const migrationGuard = new Database(migrationPath, {
      create: false,
      readwrite: true,
    });
    const runtimeGuard = new Database(runtimePath, {
      create: false,
      readwrite: true,
    });
    migrationGuard.run("BEGIN EXCLUSIVE;");
    runtimeGuard.run("BEGIN EXCLUSIVE;");
    try {
      const started = Date.now();
      expect(() => acquireDatabaseInitializationLease(config)).toThrow(
        /held purpose=runtime/,
      );
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      migrationGuard.run("ROLLBACK;");
      migrationGuard.close();
      runtimeGuard.run("ROLLBACK;");
      runtimeGuard.close();
      deleteCoordinatorRow(migrationId);
      deleteCoordinatorRow(runtimeId);
      await rm(migrationPath, { force: true });
      await rm(runtimePath, { force: true });
    }
  });

  it("cleans stale orphan guards but fails closed on a live unreferenced guard", async () => {
    const { config } = await createRuntimeConfig();
    const bootstrap = acquireRuntimeProcessLease(config);
    bootstrap.release();

    const stalePath = await createBoundGuard(randomUUID(), randomUUID());
    const old = new Date(Date.now() - 2_000);
    await utimes(stalePath, old, old);
    const lease = acquireRuntimeProcessLease(config);
    expect(() => accessSync(stalePath)).toThrow();
    lease.release();

    const livePath = await createBoundGuard(randomUUID(), randomUUID());
    await utimes(livePath, old, old);
    const live = new Database(livePath, { create: false, readwrite: true });
    live.run("BEGIN EXCLUSIVE;");
    try {
      expect(() => acquireRuntimeProcessLease(config)).toThrow(
        /live runtime guard with no coordinator row/,
      );
    } finally {
      live.run("ROLLBACK;");
      live.close();
      await rm(livePath, { force: true });
    }
  });
});
