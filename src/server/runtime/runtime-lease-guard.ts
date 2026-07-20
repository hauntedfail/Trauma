import {
  lstatSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { Database as BunDatabase } from "bun:sqlite";

import {
  assertOwnerPrivateFile,
  assertPrivateFileIdentity,
  assertValidCoordinatorRow,
  createPrivateFile,
  prepareOwnerOnlyDirectory,
  readCoordinatorRows,
  runtimeGuardDirectory,
  UUID_PATTERN,
} from "./runtime-lease-coordinator-storage";
import type {
  CoordinatorLeaseRow,
  GuardPathProbe,
  GuardProbe,
  HeldGuard,
  PrivateFileIdentity,
} from "./runtime-lease-coordinator-types";
import {
  closeLeaseDatabase,
  formatUnknownError,
  isErrorWithCode,
  isSqliteLockError,
  loadLeaseDatabaseConstructor,
} from "./runtime-lease-sqlite";

const GUARD_PREPARATION_GRACE_MS = 1_000;
const GUARD_RECHECK_INTERVAL_MS = 25;

export function acquireUniqueGuard(
  leaseId: string,
  ownerToken: string,
): HeldGuard {
  const guardDirectory = runtimeGuardDirectory();
  prepareOwnerOnlyDirectory(guardDirectory);
  const path = join(guardDirectory, `${leaseId}.sqlite`);
  createPrivateFile(path);
  const identity = assertOwnerPrivateFile(path);

  const Database = loadLeaseDatabaseConstructor();
  let database: BunDatabase | undefined;
  try {
    database = new Database(path, {
      create: false,
      readwrite: true,
      strict: true,
    });
    database.run("PRAGMA busy_timeout = 0;");
    database.run("PRAGMA journal_mode = DELETE;");
    database.run(
      `CREATE TABLE lease_guard (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lease_id TEXT NOT NULL,
        owner_token TEXT NOT NULL
      )`,
    );
    database
      .query(
        "INSERT INTO lease_guard (id, lease_id, owner_token) VALUES (1, ?1, ?2)",
      )
      .run(leaseId, ownerToken);
    database.run("BEGIN EXCLUSIVE;");
    assertPrivateFileIdentity(path, identity);
  } catch (error) {
    closeLeaseDatabase(database);
    removeGuardArtifacts(path, identity);
    throw new Error(
      `Failed to acquire TRAUMA runtime guard ${path}: ${formatUnknownError(error)}`,
    );
  }

  let released = false;
  return {
    database,
    identity,
    path,
    release() {
      if (released) {
        return;
      }
      // Closing an SQLite connection rolls back its live transaction. Do not
      // issue ROLLBACK separately: if close fails, the exclusive lock must stay
      // authoritative so an orphan probe fails closed until release is retried.
      try {
        database.close();
      } catch (error) {
        throw new Error(
          `Failed to close TRAUMA authoritative runtime guard ${path}: ${formatUnknownError(error)}`,
          { cause: error },
        );
      }
      released = true;
      removeGuardArtifacts(path, identity);
    },
  };
}

export function probeCoordinatorGuard(row: CoordinatorLeaseRow): GuardProbe {
  return { row, ...probeGuardPath(row.guard_path, row) };
}

export function probeGuardPath(
  path: string,
  expectedOwner?: Pick<CoordinatorLeaseRow, "lease_id" | "owner_token">,
): GuardPathProbe {
  let initialIdentity: PrivateFileIdentity;
  try {
    initialIdentity = assertOwnerPrivateFile(path);
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return { status: "stale" };
    }
    throw error;
  }
  const Database = loadLeaseDatabaseConstructor();
  let database: BunDatabase | undefined;
  try {
    database = new Database(path, {
      create: false,
      readwrite: true,
      strict: true,
    });
    assertPrivateFileIdentity(path, initialIdentity);
    database.run("PRAGMA busy_timeout = 0;");
    database.run("BEGIN EXCLUSIVE;");
    if (expectedOwner !== undefined) {
      const guardOwner = database
        .query("SELECT lease_id, owner_token FROM lease_guard WHERE id = 1")
        .get() as { lease_id: string; owner_token: string } | undefined;
      if (
        guardOwner?.lease_id !== expectedOwner.lease_id ||
        guardOwner.owner_token !== expectedOwner.owner_token
      ) {
        throw new Error(
          `TRAUMA runtime lease guard ${path} is not bound to its coordinator owner`,
        );
      }
    }
    database.run("ROLLBACK;");
    closeLeaseDatabase(database);
    assertPrivateFileIdentity(path, initialIdentity);
    return { identity: initialIdentity, status: "stale" };
  } catch (error) {
    closeLeaseDatabase(database);
    assertPrivateFileIdentity(path, initialIdentity);
    if (isSqliteLockError(error)) {
      return { identity: initialIdentity, status: "live" };
    }
    throw new Error(
      `Failed to probe TRAUMA runtime lease guard ${path}: ${formatUnknownError(error)}`,
    );
  }
}

export function cleanupOrphanGuards(): void {
  const rows = readCoordinatorRows();
  rows.forEach(assertValidCoordinatorRow);
  const referencedPaths = new Set(rows.map((row) => row.guard_path));
  for (const entry of readdirSync(runtimeGuardDirectory(), {
    withFileTypes: true,
  })) {
    if (
      !entry.name.endsWith(".sqlite") ||
      !UUID_PATTERN.test(entry.name.replace(/\.sqlite$/u, ""))
    ) {
      continue;
    }
    const path = join(runtimeGuardDirectory(), entry.name);
    if (referencedPaths.has(path)) {
      continue;
    }
    assertOwnerPrivateFile(path);
    if (Date.now() - lstatSync(path).mtimeMs < GUARD_PREPARATION_GRACE_MS) {
      waitForGuardRecheck();
      const refreshedRows = readCoordinatorRows();
      refreshedRows.forEach(assertValidCoordinatorRow);
      if (refreshedRows.some((row) => row.guard_path === path)) {
        continue;
      }
      throw new Error(
        `TRAUMA found a newly-created guard with no coordinator row: ${path}. ` +
          "Retry after its owner publishes or the preparation grace period expires.",
      );
    }
    let probe = probeGuardPath(path);
    if (probe.status === "live") {
      waitForGuardRecheck();
      const refreshedRows = readCoordinatorRows();
      refreshedRows.forEach(assertValidCoordinatorRow);
      if (refreshedRows.some((row) => row.guard_path === path)) {
        continue;
      }
      probe = probeGuardPath(path);
    }
    if (probe.status === "live") {
      throw new Error(
        `TRAUMA found a live runtime guard with no coordinator row: ${path}. ` +
          "Failing closed because coordinator ownership may have been removed.",
      );
    }
    removeGuardArtifacts(path, probe.identity);
  }
}

export function removeGuardArtifacts(
  path: string,
  expectedIdentity?: PrivateFileIdentity,
): void {
  if (expectedIdentity === undefined) {
    return;
  }
  try {
    assertPrivateFileIdentity(path, expectedIdentity);
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return;
    }
    console.error(
      `Refusing to remove replaced TRAUMA runtime guard ${path}: ${formatUnknownError(error)}`,
    );
    return;
  }

  if (!quarantineAndRemove(path, expectedIdentity)) {
    return;
  }

  const journalPath = `${path}-journal`;
  let journalIdentity: PrivateFileIdentity;
  try {
    journalIdentity = assertOwnerPrivateFile(journalPath);
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) {
      console.error(
        `Refusing to remove invalid TRAUMA runtime guard journal ${journalPath}: ${formatUnknownError(error)}`,
      );
    }
    return;
  }
  quarantineAndRemove(journalPath, journalIdentity);
}

/**
 * Move first, verify the moved inode, then unlink. If the source is swapped
 * between validation and rename, the unexpected file is quarantined but never
 * deleted. The private directory prevents another account from participating.
 */
function quarantineAndRemove(
  path: string,
  expectedIdentity: PrivateFileIdentity,
): boolean {
  const quarantinePath = join(
    dirname(path),
    `.quarantine-${randomUUID()}-${basename(path)}`,
  );
  try {
    renameSync(path, quarantinePath);
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return false;
    }
    console.error(
      `Failed to quarantine TRAUMA runtime guard ${path}: ${formatUnknownError(error)}`,
    );
    return false;
  }

  try {
    assertPrivateFileIdentity(quarantinePath, expectedIdentity);
  } catch (error) {
    console.error(
      `Refusing to remove swapped TRAUMA runtime guard; retained ${quarantinePath}: ${formatUnknownError(error)}`,
    );
    return false;
  }

  try {
    unlinkSync(quarantinePath);
    return true;
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) {
      console.error(
        `Failed to remove quarantined TRAUMA runtime guard ${quarantinePath}: ${formatUnknownError(error)}`,
      );
    }
    return false;
  }
}

function waitForGuardRecheck(): void {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    GUARD_RECHECK_INTERVAL_MS,
  );
}
