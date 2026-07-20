import { statSync } from "node:fs";
import { resolve } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import { runtimeDatabaseLeaseInputs } from "./runtime-database-resources";
import { RuntimeProcessLeaseError } from "./runtime-lease-errors";
import { formatUnknownError, isErrorWithCode } from "./runtime-lease-sqlite";
import {
  acquireMigrationCoordinatorLease,
  releaseCoordinatorLease,
  transitionCoordinatorLease,
} from "./runtime-lease-coordinator";
import type {
  ProcessLease,
  RuntimeLeasePlan,
} from "./runtime-lease-types";
import {
  mergeCanonicalRuntimeResources,
  resolveRuntimeResourceLeasePlan,
  runtimeResourcesAreIdentical,
  runtimeResourcesOverlap,
} from "./runtime-resource-identity";

const INITIALIZATION_LEASE_REGISTRY = Symbol.for(
  "trauma.database-initialization-leases",
);

interface SharedInitializationLease {
  admittedPlan: RuntimeLeasePlan;
  configuredDatabasePath: string;
  databasePath: string;
  initialFamilyFiles: ReadonlyMap<string, DatabaseFamilyFileState>;
  plan: RuntimeLeasePlan;
  references: number;
  releasePending: boolean;
  releaseOwner: () => void;
  state: ReturnType<typeof acquireMigrationCoordinatorLease>;
}

interface DatabaseFamilyFileState {
  anchor: string;
  links: bigint;
}

export interface DatabaseInitializationLease extends ProcessLease {
  refresh: () => void;
}

/**
 * Serializes standalone database creation, WAL setup, and optional schema
 * migration through the same bounded coordinator protocol as runtime
 * ownership. Random one-shot guards are removed on release.
 */
export function acquireDatabaseInitializationLease(
  config: ResolvedTraumaConfig,
): DatabaseInitializationLease {
  const databasePath = config.databasePath;
  const configuredDatabasePath = resolve(databasePath);
  const primary = resolveRuntimeResourceLeasePlan([
    { resourceLabel: "databasePath", resourcePath: databasePath },
  ]).resources[0];
  if (primary === undefined) {
    throw new Error("databasePath runtime resource is unavailable");
  }
  const plan = resolveRuntimeResourceLeasePlan(
    runtimeDatabaseLeaseInputs(databasePath),
  );
  const registry = readInitializationLeaseRegistry();
  const retargeted = [...registry].find(
    (entry) => entry.configuredDatabasePath === configuredDatabasePath &&
      !entry.plan.resources.some((held) =>
        plan.resources.some((candidate) => runtimeResourcesOverlap(held, candidate))
      ),
  );
  if (retargeted !== undefined) {
    throw changedDatabaseFamilyError(configuredDatabasePath);
  }
  const overlapping = [...registry].find((entry) =>
    entry.plan.resources.some((held) =>
      plan.resources.some((candidate) => runtimeResourcesOverlap(held, candidate))
    )
  );
  if (overlapping !== undefined) {
    if (overlapping.releasePending) {
      throw new RuntimeProcessLeaseError(
        `TRAUMA database initialization ownership release is pending for ` +
          `${overlapping.databasePath}; retry the original close before reopening`,
      );
    }
    if (overlapping.databasePath !== primary.resourcePath) {
      throw new RuntimeProcessLeaseError(
        `TRAUMA database initialization is already active for an overlapping ` +
          `database family; held=${overlapping.databasePath}, requested=${primary.resourcePath}`,
      );
    }
    overlapping.references += 1;
    return createInitializationLeaseHandle(overlapping);
  }

  const initialFamilyFiles = readDatabaseFamilyFiles(databasePath);
  const state = acquireMigrationCoordinatorLease(plan);
  const entry: SharedInitializationLease = {
    admittedPlan: plan,
    configuredDatabasePath,
    databasePath: primary.resourcePath,
    initialFamilyFiles,
    plan,
    references: 1,
    releasePending: false,
    releaseOwner: () => {},
    state,
  };
  entry.releaseOwner = () => {
    if (!registry.has(entry)) {
      throw new Error(
        "TRAUMA database initialization lease registry lost its active owner",
      );
    }
    releaseCoordinatorLease(state);
    registry.delete(entry);
  };
  registry.add(entry);
  return createInitializationLeaseHandle(entry);
}

function createInitializationLeaseHandle(
  entry: SharedInitializationLease,
): DatabaseInitializationLease {
  let released = false;
  return {
    get identity() {
      return entry.plan.identity;
    },
    get resources() {
      return entry.plan.resources;
    },
    refresh() {
      if (released) {
        throw new Error("Cannot refresh a released TRAUMA database initialization lease");
      }
      const fresh = resolveRuntimeResourceLeasePlan(
        runtimeDatabaseLeaseInputs(entry.configuredDatabasePath),
      );
      assertFreshDatabaseFamilyWasAdmitted(entry, fresh);
      assertNoNewDatabaseFamilyHardlinks(entry);
      const enriched = mergeCanonicalRuntimeResources(
        entry.plan,
        fresh.resources,
      );
      if (enriched.identity !== entry.plan.identity) {
        transitionCoordinatorLease(entry.state, enriched);
        entry.plan = enriched;
      }
    },
    release() {
      if (released) {
        return;
      }
      if (entry.references > 1) {
        entry.references -= 1;
        released = true;
        return;
      }
      entry.releasePending = true;
      try {
        entry.releaseOwner();
        entry.references = 0;
        entry.releasePending = false;
        released = true;
      } catch (error) {
        // Keep the final reference retryable and the registry strongly rooted.
        entry.references = 1;
        throw error;
      }
    },
  };
}

function assertFreshDatabaseFamilyWasAdmitted(
  entry: SharedInitializationLease,
  fresh: RuntimeLeasePlan,
): void {
  for (const resource of fresh.resources) {
    const admitted = entry.admittedPlan.resources.some(
      (candidate) =>
        candidate.resourcePath === resource.resourcePath &&
        runtimeResourcesAreIdentical(candidate, resource),
    );
    if (!admitted) {
      throw changedDatabaseFamilyError(entry.configuredDatabasePath);
    }
  }
}

function assertNoNewDatabaseFamilyHardlinks(
  entry: SharedInitializationLease,
): void {
  const current = readDatabaseFamilyFiles(entry.configuredDatabasePath);
  for (const [path, state] of current) {
    if (state.links <= BigInt(1)) {
      continue;
    }
    const admitted = entry.initialFamilyFiles.get(path);
    if (
      admitted === undefined ||
      admitted.anchor !== state.anchor ||
      admitted.links !== state.links
    ) {
      throw changedDatabaseFamilyError(entry.configuredDatabasePath);
    }
  }
}

function readDatabaseFamilyFiles(
  databasePath: string,
): ReadonlyMap<string, DatabaseFamilyFileState> {
  const files = new Map<string, DatabaseFamilyFileState>();
  for (const input of runtimeDatabaseLeaseInputs(databasePath)) {
    try {
      const stats = statSync(input.resourcePath, { bigint: true });
      files.set(input.resourcePath, {
        anchor: `${stats.dev.toString()}:${stats.ino.toString()}`,
        links: stats.nlink,
      });
    } catch (error) {
      if (isErrorWithCode(error, "ENOENT")) {
        continue;
      }
      throw new RuntimeProcessLeaseError(
        `TRAUMA could not verify database initialization resource ` +
          `${input.resourcePath}: ${formatUnknownError(error)}`,
      );
    }
  }
  return files;
}

function changedDatabaseFamilyError(databasePath: string): RuntimeProcessLeaseError {
  return new RuntimeProcessLeaseError(
    `TRAUMA database initialization resource changed after ownership was acquired ` +
      `for ${databasePath}; stop and inspect the database path before retrying`,
  );
}

function readInitializationLeaseRegistry(): Set<SharedInitializationLease> {
  const global = globalThis as typeof globalThis & {
    [INITIALIZATION_LEASE_REGISTRY]?: Set<SharedInitializationLease>;
  };
  global[INITIALIZATION_LEASE_REGISTRY] ??= new Set();
  return global[INITIALIZATION_LEASE_REGISTRY];
}

export const acquireDatabaseMigrationLease = acquireDatabaseInitializationLease;
