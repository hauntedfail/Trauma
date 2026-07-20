import { randomUUID } from "node:crypto";

import { RuntimeProcessLeaseError } from "./runtime-lease-errors";
import {
  acquireUniqueGuard,
  cleanupOrphanGuards,
  probeCoordinatorGuard,
  removeGuardArtifacts,
} from "./runtime-lease-guard";
import {
  assertPlanDoesNotOverlapCoordinatorStorage,
  assertPrivateFileIdentity,
  assertValidCoordinatorRow,
  deleteCoordinatorRow,
  insertCoordinatorRow,
  openCoordinatorDatabase,
  prepareCoordinatorStorage,
  readCoordinatorRow,
  readCoordinatorRows,
  readCoordinatorRowsFrom,
  resetRuntimeLeaseCoordinatorPathForTesting,
  resolveDefaultRuntimeLeaseCoordinatorPath,
  resolveRuntimeLeaseCoordinatorPath,
  setRuntimeLeaseCoordinatorPathForTesting,
  updateCoordinatorRow,
} from "./runtime-lease-coordinator-storage";
import type {
  CoordinatorLeasePurpose,
  CoordinatorLeaseRow,
  CoordinatorLeaseState,
  CoordinatorOwner,
  GuardProbe,
  PrivateFileIdentity,
} from "./runtime-lease-coordinator-types";
import {
  parseRuntimeRootSet,
  runtimeResourcesOverlap,
} from "./runtime-resource-identity";
import {
  closeLeaseDatabase,
  formatUnknownError,
  rollbackLeaseDatabaseQuietly,
} from "./runtime-lease-sqlite";
import type {
  RuntimeLeasePlan,
  RuntimeProcessLeaseResource,
} from "./runtime-lease-types";

const MIGRATION_LEASE_WAIT_MS = 5_000;
const MIGRATION_RETRY_INTERVAL_MS = 25;
const MAX_COORDINATOR_CAS_ATTEMPTS = 8;

export type { CoordinatorLeaseState };
export {
  resetRuntimeLeaseCoordinatorPathForTesting,
  resolveDefaultRuntimeLeaseCoordinatorPath,
  resolveRuntimeLeaseCoordinatorPath,
  setRuntimeLeaseCoordinatorPathForTesting,
};

export function acquireCoordinatorLease(
  plan: RuntimeLeasePlan,
): CoordinatorLeaseState {
  return acquireCoordinatorLeaseForPurpose(plan, "runtime");
}

export function acquireMigrationCoordinatorLease(
  plan: RuntimeLeasePlan,
): CoordinatorLeaseState {
  const deadline = Date.now() + MIGRATION_LEASE_WAIT_MS;
  prepareCoordinatorStorage();
  cleanupOrphanGuards();
  assertPlanDoesNotOverlapCoordinatorStorage(plan);
  while (true) {
    const liveOverlap = findLiveCoordinatorOverlap(plan);
    if (liveOverlap !== undefined) {
      if (liveOverlap.purpose === "runtime" || Date.now() >= deadline) {
        throw createActiveCoordinatorLeaseError(
          plan,
          liveOverlap,
          "migration",
        );
      }
      waitForMigrationRetry(deadline);
      continue;
    }
    try {
      return acquireCoordinatorLeaseForPurpose(plan, "migration");
    } catch (error) {
      if (!(error instanceof RuntimeProcessLeaseError) || Date.now() >= deadline) {
        throw error;
      }
      waitForMigrationRetry(deadline);
    }
  }
}

export function transitionCoordinatorLease(
  state: CoordinatorLeaseState,
  nextPlan: RuntimeLeasePlan,
): void {
  const row = publishCoordinatorPlan(
    state.owner,
    state.row,
    nextPlan,
    state.purpose,
  );
  state.plan = nextPlan;
  state.row = row;
}

export function assertCoordinatorLeaseOwnerIntact(
  state: CoordinatorLeaseState,
): void {
  assertPrivateFileIdentity(state.owner.guard.path, state.owner.guard.identity);
}

export function releaseCoordinatorLease(state: CoordinatorLeaseState): void {
  if (!state.coordinatorRowReleased) {
    const database = openCoordinatorDatabase();
    let transactionOpen = false;
    try {
      database.run("BEGIN IMMEDIATE;");
      transactionOpen = true;
      deleteCoordinatorRow(database, state.row);
      database.run("COMMIT;");
      transactionOpen = false;
      state.coordinatorRowReleased = true;
    } catch (error) {
      if (transactionOpen) {
        rollbackLeaseDatabaseQuietly(database);
      }
      throw new Error(
        `Failed to release TRAUMA runtime lease without dropping ownership: ${formatUnknownError(error)}`,
        { cause: error },
      );
    } finally {
      closeLeaseDatabase(database);
    }
  }

  // Exact row deletion committed. Only now may the authoritative guard close;
  // if close fails, the state remembers the commit so guard close can retry.
  state.owner.guard.release();
}

function acquireCoordinatorLeaseForPurpose(
  plan: RuntimeLeasePlan,
  purpose: CoordinatorLeasePurpose,
): CoordinatorLeaseState {
  prepareCoordinatorStorage();
  cleanupOrphanGuards();
  assertPlanDoesNotOverlapCoordinatorStorage(plan);
  const leaseId = randomUUID();
  const ownerToken = randomUUID();
  const owner: CoordinatorOwner = {
    guard: acquireUniqueGuard(leaseId, ownerToken),
    leaseId,
    ownerToken,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  try {
    const row = publishCoordinatorPlan(owner, undefined, plan, purpose);
    return {
      coordinatorRowReleased: false,
      owner,
      plan,
      purpose,
      row,
    };
  } catch (error) {
    owner.guard.release();
    throw error;
  }
}

function findLiveCoordinatorOverlap(
  plan: RuntimeLeasePlan,
): CoordinatorLeaseRow | undefined {
  const rows = readCoordinatorRows();
  rows.forEach(assertValidCoordinatorRow);
  const liveOverlaps = rows
    .filter((row) => rowOverlapsPlan(row, plan))
    .filter((row) => probeCoordinatorGuard(row).status === "live");
  // SQL row order is not an ownership policy: runtime ownership must always
  // make database initialization fail immediately.
  return liveOverlaps.find((row) => row.purpose === "runtime") ??
    liveOverlaps[0];
}

function waitForMigrationRetry(deadline: number): void {
  const remaining = Math.max(1, deadline - Date.now());
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    Math.min(MIGRATION_RETRY_INTERVAL_MS, remaining),
  );
}

function publishCoordinatorPlan(
  owner: CoordinatorOwner,
  previousRow: CoordinatorLeaseRow | undefined,
  targetPlan: RuntimeLeasePlan,
  purpose: CoordinatorLeasePurpose,
): CoordinatorLeaseRow {
  assertPlanDoesNotOverlapCoordinatorStorage(targetPlan);
  assertPrivateFileIdentity(owner.guard.path, owner.guard.identity);
  for (let attempt = 0; attempt < MAX_COORDINATOR_CAS_ATTEMPTS; attempt += 1) {
    // Guard probes never run inside the coordinator write transaction.
    const snapshot = readCoordinatorRows().filter(
      (row) => row.lease_id !== owner.leaseId,
    );
    snapshot.forEach(assertValidCoordinatorRow);
    const result = commitCoordinatorPlan(
      owner,
      previousRow,
      targetPlan,
      snapshot.map(probeCoordinatorGuard),
      purpose,
    );
    if (result.status === "published") {
      return result.row;
    }
  }

  throw new Error(
    "TRAUMA runtime lease coordinator changed repeatedly during acquisition; retry startup",
  );
}

function commitCoordinatorPlan(
  owner: CoordinatorOwner,
  previousRow: CoordinatorLeaseRow | undefined,
  targetPlan: RuntimeLeasePlan,
  probes: GuardProbe[],
  purpose: CoordinatorLeasePurpose,
): { status: "published"; row: CoordinatorLeaseRow } | { status: "retry" } {
  const database = openCoordinatorDatabase();
  let transactionOpen = false;
  const staleGuards: Array<{
    identity?: PrivateFileIdentity;
    path: string;
  }> = [];
  try {
    database.run("BEGIN IMMEDIATE;");
    transactionOpen = true;
    assertPrivateFileIdentity(owner.guard.path, owner.guard.identity);

    if (previousRow !== undefined) {
      const currentOwnerRow = readCoordinatorRow(database, owner.leaseId);
      if (currentOwnerRow !== undefined) {
        assertValidCoordinatorRow(currentOwnerRow);
      }
      if (
        currentOwnerRow === undefined ||
        coordinatorRowKey(currentOwnerRow) !== coordinatorRowKey(previousRow)
      ) {
        database.run("ROLLBACK;");
        transactionOpen = false;
        throw new Error(
          "TRAUMA runtime lease ownership changed unexpectedly; keeping the guard held and failing closed",
        );
      }
    }

    const latestRows = readCoordinatorRowsFrom(database).filter(
      (row) => row.lease_id !== owner.leaseId,
    );
    latestRows.forEach(assertValidCoordinatorRow);
    const latestOverlaps = latestRows.filter((row) =>
      rowOverlapsPlan(row, targetPlan)
    );
    const probesByKey = new Map(
      probes.map((probe) => [coordinatorRowKey(probe.row), probe]),
    );
    if (
      latestOverlaps.some(
        (row) => probesByKey.get(coordinatorRowKey(row)) === undefined,
      )
    ) {
      database.run("ROLLBACK;");
      transactionOpen = false;
      return { status: "retry" };
    }

    const liveOverlaps = latestOverlaps.filter(
      (row) => probesByKey.get(coordinatorRowKey(row))?.status === "live",
    );
    const liveOverlap = purpose === "migration"
      ? liveOverlaps.find((row) => row.purpose === "runtime") ?? liveOverlaps[0]
      : liveOverlaps[0];
    if (liveOverlap !== undefined) {
      database.run("ROLLBACK;");
      transactionOpen = false;
      throw createActiveCoordinatorLeaseError(targetPlan, liveOverlap, purpose);
    }

    const staleRows = latestRows.filter(
      (row) => probesByKey.get(coordinatorRowKey(row))?.status === "stale",
    );
    for (const row of staleRows) {
      deleteCoordinatorRow(database, row);
      const probe = probesByKey.get(coordinatorRowKey(row));
      staleGuards.push({ identity: probe?.identity, path: row.guard_path });
    }

    const nextRow = createCoordinatorRow(owner, targetPlan, purpose);
    if (previousRow === undefined) {
      insertCoordinatorRow(database, nextRow);
    } else {
      updateCoordinatorRow(database, previousRow, nextRow);
    }
    database.run("COMMIT;");
    transactionOpen = false;

    for (const guard of staleGuards) {
      removeGuardArtifacts(guard.path, guard.identity);
    }
    return { status: "published", row: nextRow };
  } catch (error) {
    if (transactionOpen) {
      rollbackLeaseDatabaseQuietly(database);
    }
    throw error;
  } finally {
    closeLeaseDatabase(database);
  }
}

function createCoordinatorRow(
  owner: CoordinatorOwner,
  plan: RuntimeLeasePlan,
  purpose: CoordinatorLeasePurpose,
): CoordinatorLeaseRow {
  return {
    display_resources: JSON.stringify(
      plan.resources.map((resource) => ({
        resourceLabels: resource.resourceLabels,
        resourcePath: resource.resourcePath,
      })),
    ),
    guard_path: owner.guard.path,
    lease_id: owner.leaseId,
    owner_pid: owner.pid,
    owner_token: owner.ownerToken,
    purpose,
    root_set: plan.rootSet,
    started_at: owner.startedAt,
  };
}

function rowOverlapsPlan(
  row: CoordinatorLeaseRow,
  plan: RuntimeLeasePlan,
): boolean {
  return parseRuntimeRootSet(row.root_set).some((rowResource) =>
    plan.resources.some((resource) =>
      runtimeResourcesOverlap(rowResource, resource)
    )
  );
}

function coordinatorRowKey(row: CoordinatorLeaseRow): string {
  return JSON.stringify([
    row.lease_id,
    row.owner_token,
    row.purpose,
    row.guard_path,
    row.root_set,
  ]);
}

function createActiveCoordinatorLeaseError(
  plan: RuntimeLeasePlan,
  owner: CoordinatorLeaseRow,
  purpose: CoordinatorLeasePurpose,
): RuntimeProcessLeaseError {
  const ownerResources = parseRuntimeRootSet(owner.root_set);
  const overlap = plan.resources
    .flatMap((candidate) =>
      ownerResources.map((held) => ({ candidate, held }))
    )
    .find(({ candidate, held }) => runtimeResourcesOverlap(candidate, held));
  const overlapSummary = overlap === undefined
    ? "an overlapping runtime resource"
    : `${formatResource(overlap.candidate)} with held ${formatResource(overlap.held)}`;
  const activity = purpose === "migration" ? "migration" : "runtime";
  return new RuntimeProcessLeaseError(
    `TRAUMA ${activity} is already active for ${overlapSummary} ` +
      `(held purpose=${owner.purpose}, reported owner pid=${owner.owner_pid}, ` +
      `startedAt=${owner.started_at}). ` +
      "Stop the other TRAUMA server or maintenance CLI before retrying. " +
      `coordinator=${resolveRuntimeLeaseCoordinatorPath()}.`,
  );
}

function formatResource(resource: RuntimeProcessLeaseResource): string {
  return `${resource.resourceLabels.join("/")}=${resource.resourcePath}`;
}
