import type { ResolvedTraumaConfig } from "../config";
import {
  acquireDatabaseInitializationLease,
  acquireDatabaseMigrationLease,
} from "./migration-lease";
import { runtimeDatabaseLeaseInputs } from "./runtime-database-resources";
import {
  acquireCoordinatorLease,
  assertCoordinatorLeaseOwnerIntact,
  type CoordinatorLeaseState,
  releaseCoordinatorLease,
  resolveRuntimeLeaseCoordinatorPath,
  transitionCoordinatorLease,
} from "./runtime-lease-coordinator";
import { RuntimeProcessLeaseCoverageError } from "./runtime-lease-errors";
import {
  extendRuntimeResourceLeasePlan,
  mergeCanonicalRuntimeResources,
  resolveRuntimeResourceLeasePlan,
  runtimeResourcesAreIdentical,
} from "./runtime-resource-identity";
import type {
  RuntimeLeasePlan,
  RuntimeProcessLease,
  RuntimeProcessLeaseBorrow,
  RuntimeResourceLeaseInput,
} from "./runtime-lease-types";

const RUNTIME_LEASE_REGISTRY = Symbol.for("trauma.runtime-process-lease");

interface RuntimeLeaseRegistry {
  activeLeases?: Set<RuntimeProcessLease>;
  persistentLease?: RuntimeProcessLease;
}

export {
  acquireDatabaseInitializationLease,
  acquireDatabaseMigrationLease,
  resolveRuntimeLeaseCoordinatorPath,
};
export {
  resolveDefaultRuntimeLeaseCoordinatorPath,
  resetRuntimeLeaseCoordinatorPathForTesting,
  setRuntimeLeaseCoordinatorPathForTesting,
} from "./runtime-lease-coordinator";
export { runtimeDatabaseLeaseInputs } from "./runtime-database-resources";
export {
  RuntimeProcessLeaseCoverageError,
  RuntimeProcessLeaseError,
} from "./runtime-lease-errors";
export type {
  ProcessLease,
  RuntimeProcessLease,
  RuntimeProcessLeaseBorrow,
  RuntimeProcessLeaseResource,
  RuntimeResourceLeaseInput,
} from "./runtime-lease-types";

export function ensureRuntimeProcessLease(
  config: ResolvedTraumaConfig,
): RuntimeProcessLease {
  const plan = resolveRuntimeProcessLeasePlan(config);
  const registry = readRuntimeLeaseRegistry();
  const existing = registry.persistentLease;
  if (existing !== undefined) {
    existing.assertCovers(runtimeLeaseInputsForConfig(config));
    return existing;
  }

  const acquired = acquireCoordinatorLease(plan);
  let managed: RuntimeProcessLease;
  managed = wrapRuntimeLease(acquired, () => {
    if (registry.persistentLease === managed) {
      registry.persistentLease = undefined;
    }
  });
  registry.persistentLease = managed;
  return managed;
}

/**
 * Bootstrap request middleware once per Bun process. A held lease is returned
 * before invoking the loader, so steady-state requests do not parse config or
 * resolve filesystem identities again. Failed bootstraps remain retryable.
 */
export function ensureRuntimeProcessLeaseFromLoader(
  loadConfig: () => ResolvedTraumaConfig,
): RuntimeProcessLease {
  const existing = readRuntimeLeaseRegistry().persistentLease;
  return existing ?? ensureRuntimeProcessLease(loadConfig());
}

export function assertRuntimeProcessLeaseCoversConfig(
  config: ResolvedTraumaConfig,
): void {
  assertRuntimeProcessLeaseCoversResources(runtimeLeaseInputsForConfig(config));
}

export function assertRuntimeProcessLeaseCoversResources(
  resources: readonly RuntimeResourceLeaseInput[],
): void {
  const registry = readRuntimeLeaseRegistry();
  if (registry.persistentLease !== undefined) {
    registry.persistentLease.assertCovers(resources);
    return;
  }
  const activeLeases = [...(registry.activeLeases ?? [])];
  const admittingLease = activeLeases.find((lease) => lease.admits(resources));
  if (admittingLease !== undefined) {
    admittingLease.assertCovers(resources);
    return;
  }
  // Direct library initialization intentionally remains supported without a
  // runtime lease. If this process does hold leases, however, a config that no
  // active plan admits must fail rather than silently using reserved-only roots.
  activeLeases[0]?.assertCovers(resources);
}

export function borrowRuntimeProcessLeaseForResources(
  resources: readonly RuntimeResourceLeaseInput[],
): RuntimeProcessLeaseBorrow | undefined {
  const registry = readRuntimeLeaseRegistry();
  if (registry.persistentLease !== undefined) {
    return registry.persistentLease.borrow(resources);
  }
  const activeLeases = [...(registry.activeLeases ?? [])];
  const admittingLease = activeLeases.find((lease) => lease.admits(resources));
  if (admittingLease !== undefined) {
    return admittingLease.borrow(resources);
  }
  // Preserve the same fail-closed reserved-only/config-change behavior as the
  // assertion API. Direct database use with no runtime owner remains valid.
  activeLeases[0]?.assertCovers(resources);
  return undefined;
}

export function reserveRuntimeProcessLeaseResources(
  currentResources: readonly RuntimeResourceLeaseInput[],
  additionalResources: readonly RuntimeResourceLeaseInput[],
): void {
  const lease = requireAdmittingRuntimeLease(currentResources);
  lease.expand(additionalResources);
}

export function suspendRuntimeStorageAdmission(
  currentResources: readonly RuntimeResourceLeaseInput[],
): void {
  const lease = findAdmittingRuntimeLease(currentResources);
  if (lease === undefined) {
    const activeLeases = [...(readRuntimeLeaseRegistry().activeLeases ?? [])];
    activeLeases[0]?.assertCovers(currentResources);
    throw new RuntimeProcessLeaseCoverageError(
      "TRAUMA cannot suspend storage admission without an active runtime lease",
    );
  }
  try {
    lease.assertCovers(currentResources);
  } finally {
    // Once suspension is requested, any ownership-integrity failure must leave
    // local admission closed rather than allowing more storage work.
    lease.invalidateActiveCoverage();
  }
}

function requireAdmittingRuntimeLease(
  currentResources: readonly RuntimeResourceLeaseInput[],
): RuntimeProcessLease {
  const activeLeases = [...(readRuntimeLeaseRegistry().activeLeases ?? [])];
  const lease = findAdmittingRuntimeLease(currentResources);
  if (lease === undefined) {
    activeLeases[0]?.assertCovers(currentResources);
    throw new RuntimeProcessLeaseCoverageError(
      "TRAUMA cannot coordinate storage admission without an active runtime lease",
    );
  }
  lease.assertCovers(currentResources);
  return lease;
}

function findAdmittingRuntimeLease(
  currentResources: readonly RuntimeResourceLeaseInput[],
): RuntimeProcessLease | undefined {
  const registry = readRuntimeLeaseRegistry();
  return registry.persistentLease ??
    [...(registry.activeLeases ?? [])].find((candidate) =>
      candidate.admits(currentResources)
    );
}

export function releaseRuntimeProcessLeasesForTesting(): void {
  for (const lease of [...(readRuntimeLeaseRegistry().activeLeases ?? [])]) {
    lease.release();
  }
}

export function acquireRuntimeProcessLease(
  config: ResolvedTraumaConfig,
  additionalResources: readonly RuntimeResourceLeaseInput[] = [],
): RuntimeProcessLease {
  const activePlan = resolveRuntimeProcessLeasePlan(config);
  const reservedPlan = resolveRuntimeProcessLeasePlan(
    config,
    additionalResources,
  );
  return wrapRuntimeLease(acquireCoordinatorLease(reservedPlan), undefined, activePlan);
}

export function acquireRuntimeResourceLeases(
  resources: readonly RuntimeResourceLeaseInput[],
): RuntimeProcessLease {
  return wrapRuntimeLease(
    acquireCoordinatorLease(resolveRuntimeResourceLeasePlan(resources)),
  );
}

export async function withRuntimeProcessLease<T>(
  config: ResolvedTraumaConfig,
  operation: () => T | Promise<T>,
  additionalResources: readonly RuntimeResourceLeaseInput[] = [],
): Promise<T> {
  const lease = acquireRuntimeProcessLease(config, additionalResources);
  try {
    return await operation();
  } finally {
    lease.release();
  }
}

export async function withRuntimeResourceLeases<T>(
  resources: readonly RuntimeResourceLeaseInput[],
  operation: () => T | Promise<T>,
): Promise<T> {
  const lease = acquireRuntimeResourceLeases(resources);
  try {
    return await operation();
  } finally {
    lease.release();
  }
}

export function resolveRuntimeProcessLeasePaths(
  config: ResolvedTraumaConfig,
  additionalResources: readonly RuntimeResourceLeaseInput[] = [],
): {
  coordinatorPath: string;
  identity: string;
  resources: RuntimeLeasePlan["resources"];
} {
  const plan = resolveRuntimeProcessLeasePlan(config, additionalResources);
  return {
    coordinatorPath: resolveRuntimeLeaseCoordinatorPath(),
    identity: plan.identity,
    resources: plan.resources,
  };
}

export function runtimeLeaseInputsForConfig(
  config: ResolvedTraumaConfig,
): RuntimeResourceLeaseInput[] {
  return [
    ...runtimeDatabaseLeaseInputs(config.databasePath),
    { resourceLabel: "projectPath", resourcePath: config.projectPath },
    { resourceLabel: "storePath", resourcePath: config.storePath },
  ];
}

function resolveRuntimeProcessLeasePlan(
  config: ResolvedTraumaConfig,
  additionalResources: readonly RuntimeResourceLeaseInput[] = [],
): RuntimeLeasePlan {
  return resolveRuntimeResourceLeasePlan([
    ...runtimeLeaseInputsForConfig(config),
    ...additionalResources,
  ]);
}

function wrapRuntimeLease(
  state: CoordinatorLeaseState,
  afterRelease?: () => void,
  initialActivePlan: RuntimeLeasePlan = state.plan,
): RuntimeProcessLease {
  let releaseRequested = false;
  let released = false;
  let borrowers = 0;
  let reservedPlan = state.plan;
  let activePlan: RuntimeLeasePlan | undefined = initialActivePlan;

  const assertCoverage = (
    inputs: readonly RuntimeResourceLeaseInput[],
  ): void => {
    if (released) {
      throw new Error("Cannot validate coverage with a released TRAUMA runtime lease");
    }
    if (activePlan === undefined) {
      throw new RuntimeProcessLeaseCoverageError(
        "TRAUMA storage admission is suspended after a root-changing recovery. " +
          "Restart TRAUMA before accessing storage again.",
      );
    }
    assertCoordinatorLeaseOwnerIntact(state);
    let nextActivePlan = activePlan;
    let nextReservedPlan = reservedPlan;
    for (const input of inputs) {
      const canonical = resolveRuntimeResourceLeasePlan([input]).resources[0];
      const canonicalMatch = canonical !== undefined &&
        nextActivePlan.resources.some(
          (resource) =>
            resource.resourceLabels.includes(input.resourceLabel) &&
            runtimeResourcesAreIdentical(resource, canonical),
        );
      if (!canonicalMatch) {
        throw new RuntimeProcessLeaseCoverageError(
          `TRAUMA runtime configuration changed for ${input.resourceLabel}=` +
            `${input.resourcePath} while another storage root is active. ` +
            "Stop and restart TRAUMA before accessing the new root.",
        );
      }
      nextActivePlan = mergeCanonicalRuntimeResources(nextActivePlan, [canonical]);
      nextReservedPlan = mergeCanonicalRuntimeResources(nextReservedPlan, [canonical]);
    }
    if (nextReservedPlan.identity !== reservedPlan.identity) {
      transitionCoordinatorLease(state, nextReservedPlan);
      reservedPlan = nextReservedPlan;
    }
    activePlan = nextActivePlan;
  };

  const finalizeReleaseIfUnborrowed = (): void => {
    if (!releaseRequested || released || borrowers !== 0) {
      return;
    }
    releaseCoordinatorLease(state);
    released = true;
    readRuntimeLeaseRegistry().activeLeases?.delete(lease);
  };

  const lease: RuntimeProcessLease = {
    admits(inputs) {
      if (releaseRequested || released || activePlan === undefined) {
        return false;
      }
      return inputs.every((input) => {
        const canonical = resolveRuntimeResourceLeasePlan([input]).resources[0];
        return canonical !== undefined && activePlan?.resources.some(
          (resource) =>
            resource.resourceLabels.includes(input.resourceLabel) &&
            runtimeResourcesAreIdentical(resource, canonical),
        ) === true;
      });
    },
    get identity() {
      return reservedPlan.identity;
    },
    get resources() {
      return reservedPlan.resources;
    },
    assertCovers(inputs) {
      assertNotReleaseRequested(releaseRequested, "validate coverage with");
      assertCoverage(inputs);
    },
    borrow(inputs) {
      assertNotReleaseRequested(releaseRequested, "borrow");
      assertCoverage(inputs);
      borrowers += 1;
      let borrowReturned = false;
      return {
        assertCovers(borrowInputs) {
          if (borrowReturned) {
            throw new Error(
              "Cannot validate coverage with a released TRAUMA runtime lease borrow",
            );
          }
          assertCoverage(borrowInputs);
        },
        release() {
          if (!borrowReturned) {
            borrowReturned = true;
            borrowers -= 1;
          }
          finalizeReleaseIfUnborrowed();
        },
      };
    },
    expand(additionalResources) {
      assertNotReleaseRequested(releaseRequested, "expand");
      assertCoordinatorLeaseOwnerIntact(state);
      const nextPlan = extendRuntimeResourceLeasePlan(
        reservedPlan,
        additionalResources,
      );
      if (nextPlan.identity !== reservedPlan.identity) {
        transitionCoordinatorLease(state, nextPlan);
        reservedPlan = nextPlan;
      }
    },
    invalidateActiveCoverage() {
      assertNotReleaseRequested(releaseRequested, "invalidate active coverage for");
      activePlan = undefined;
    },
    reserves(inputs) {
      if (releaseRequested || released) {
        return false;
      }
      return inputs.every((input) => {
        const canonical = resolveRuntimeResourceLeasePlan([input]).resources[0];
        return canonical !== undefined && reservedPlan.resources.some(
          (resource) =>
            resource.resourceLabels.includes(input.resourceLabel) &&
            runtimeResourcesAreIdentical(resource, canonical),
        );
      });
    },
    release() {
      if (releaseRequested) {
        finalizeReleaseIfUnborrowed();
        return;
      }
      releaseRequested = true;
      afterRelease?.();
      finalizeReleaseIfUnborrowed();
    },
  };
  const registry = readRuntimeLeaseRegistry();
  registry.activeLeases ??= new Set();
  registry.activeLeases.add(lease);
  return lease;
}

function assertNotReleaseRequested(
  releaseRequested: boolean,
  operation: string,
): void {
  if (releaseRequested) {
    throw new Error(`Cannot ${operation} a released TRAUMA runtime lease`);
  }
}

function readRuntimeLeaseRegistry(): RuntimeLeaseRegistry {
  const global = globalThis as typeof globalThis & {
    [RUNTIME_LEASE_REGISTRY]?: RuntimeLeaseRegistry;
  };
  global[RUNTIME_LEASE_REGISTRY] ??= {};
  return global[RUNTIME_LEASE_REGISTRY];
}
