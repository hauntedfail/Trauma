import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { formatUnknownError, isErrorWithCode } from "./runtime-lease-sqlite";
import type {
  CanonicalPathIdentity,
  RuntimeLeasePlan,
  RuntimeProcessLeaseResource,
  RuntimeResourceLeaseInput,
} from "./runtime-lease-types";

export const RUNTIME_COORDINATOR_SCHEMA_VERSION = 2;

interface SerializedRuntimeResource {
  identities: CanonicalPathIdentity[];
  resourceLabels: string[];
  resourcePath: string;
}

export function resolveRuntimeResourceLeasePlan(
  inputs: readonly RuntimeResourceLeaseInput[],
): RuntimeLeasePlan {
  if (inputs.length === 0) {
    throw new Error("At least one runtime resource is required for a lease");
  }
  return createRuntimeResourceLeasePlan(
    inputs.map(canonicalizeRuntimeResource),
  );
}

export function extendRuntimeResourceLeasePlan(
  plan: RuntimeLeasePlan,
  additionalInputs: readonly RuntimeResourceLeaseInput[],
): RuntimeLeasePlan {
  return createRuntimeResourceLeasePlan([
    ...plan.resources,
    ...additionalInputs.map(canonicalizeRuntimeResource),
  ]);
}

export function mergeCanonicalRuntimeResources(
  plan: RuntimeLeasePlan,
  resources: readonly RuntimeProcessLeaseResource[],
): RuntimeLeasePlan {
  return createRuntimeResourceLeasePlan([...plan.resources, ...resources]);
}

export function runtimeResourcesAreIdentical(
  left: RuntimeProcessLeaseResource,
  right: RuntimeProcessLeaseResource,
): boolean {
  return left.identities.some((leftIdentity) =>
    right.identities.some(
      (rightIdentity) =>
        leftIdentity.anchor === rightIdentity.anchor &&
        arraysEqual(leftIdentity.suffix, rightIdentity.suffix),
    )
  );
}

export function runtimeResourcesOverlap(
  left: RuntimeProcessLeaseResource,
  right: RuntimeProcessLeaseResource,
): boolean {
  return left.identities.some((leftIdentity) =>
    right.identities.some(
      (rightIdentity) =>
        leftIdentity.anchor === rightIdentity.anchor &&
        (isSegmentPrefix(leftIdentity.suffix, rightIdentity.suffix) ||
          isSegmentPrefix(rightIdentity.suffix, leftIdentity.suffix)),
    )
  );
}

export function parseRuntimeRootSet(
  rootSet: string,
): RuntimeProcessLeaseResource[] {
  let value: unknown;
  try {
    value = JSON.parse(rootSet);
  } catch (error) {
    throw new Error(
      `TRAUMA runtime coordinator contains invalid root-set JSON: ${formatUnknownError(error)}`,
    );
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["resources", "schemaVersion"]) ||
    value.schemaVersion !== RUNTIME_COORDINATOR_SCHEMA_VERSION ||
    !Array.isArray(value.resources) ||
    value.resources.length === 0 ||
    !value.resources.every(isSerializedRuntimeResource)
  ) {
    throw new Error("TRAUMA runtime coordinator contains an invalid root set");
  }
  return value.resources;
}

function createRuntimeResourceLeasePlan(
  canonicalResources: readonly RuntimeProcessLeaseResource[],
): RuntimeLeasePlan {
  const resources: RuntimeProcessLeaseResource[] = [];
  for (const canonical of canonicalResources) {
    const duplicate = resources.find((resource) =>
      runtimeResourcesAreIdentical(resource, canonical)
    );
    if (duplicate === undefined) {
      resources.push(canonical);
      continue;
    }
    const labels = new Set([
      ...duplicate.resourceLabels,
      ...canonical.resourceLabels,
    ]);
    const identities = new Map(
      [...duplicate.identities, ...canonical.identities].map((identity) => [
        JSON.stringify(identity),
        identity,
      ]),
    );
    resources[resources.indexOf(duplicate)] = {
      ...duplicate,
      identities: [...identities.values()].sort(compareCanonicalIdentities),
      resourceLabels: [...labels].sort(),
    };
  }

  resources.sort(compareResources);
  const rootSet = JSON.stringify({
    schemaVersion: RUNTIME_COORDINATOR_SCHEMA_VERSION,
    resources: resources.map(serializeResource),
  });
  return { identity: rootSet, resources, rootSet };
}

function canonicalizeRuntimeResource(
  input: RuntimeResourceLeaseInput,
): RuntimeProcessLeaseResource {
  if (!isValidResourceLabel(input.resourceLabel)) {
    throw new Error(
      `Invalid runtime lease resourceLabel: ${input.resourceLabel}`,
    );
  }

  const unresolvedParts: string[] = [];
  let candidate = resolve(input.resourcePath);
  let existingPath: string | undefined;
  while (existingPath === undefined) {
    try {
      existingPath = realpathSync.native(candidate);
    } catch (error) {
      if (!isErrorWithCode(error, "ENOENT")) {
        throw new Error(
          `Failed to canonicalize runtime resource ${input.resourceLabel}=${input.resourcePath}: ${formatUnknownError(error)}`,
        );
      }
      assertMissingCandidateIsNotDanglingSymlink(candidate, input);
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new Error(
          `No existing filesystem root is available for runtime resource ${input.resourcePath}`,
        );
      }
      unresolvedParts.unshift(basename(candidate));
      candidate = parent;
    }
  }

  // APFS/HFS+ and Windows commonly case-fold missing names. Conservatively
  // fold comparison suffixes on those platforms so pre-creation aliases cannot
  // split a lease. The actual effective path spelling remains untouched.
  const normalizedUnresolved = unresolvedParts.map((part) =>
    normalizeRuntimePathSegment(part)
  );
  // Keep the filesystem's native spelling for operational diagnostics. Only
  // comparison identities are normalized: NFC and NFD are distinct names on
  // filesystems such as ext4, so rewriting this path could point operators at
  // a different resource from the one that was actually leased.
  const resourcePath = join(existingPath, ...unresolvedParts);
  const identities: CanonicalPathIdentity[] = [];
  let cursor = existingPath;
  let suffix = [...normalizedUnresolved];
  while (true) {
    const stats = statSync(cursor, { bigint: true });
    identities.push({
      anchor: `${stats.dev.toString()}:${stats.ino.toString()}`,
      suffix: [...suffix],
    });
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    suffix = [
      normalizeRuntimePathSegment(basename(cursor)),
      ...suffix,
    ];
    cursor = parent;
  }
  identities.sort(compareCanonicalIdentities);

  const resource: RuntimeProcessLeaseResource = {
    identities,
    resourceLabels: [input.resourceLabel],
    resourcePath,
  };
  if (!isSerializedRuntimeResource(serializeResource(resource))) {
    throw new Error(
      `Runtime resource path cannot be represented safely: ${input.resourcePath}`,
    );
  }
  return resource;
}

export function normalizeRuntimePathSegment(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "darwin" && platform !== "win32") {
    // Linux and other case-sensitive platforms may treat NFC and NFD spellings
    // as distinct sibling names. Preserve their exact comparison bytes.
    return value;
  }

  // JavaScript does not expose Unicode Default Case Folding. The
  // lower-then-upper-then-lower transform covers multi-character folds that a plain
  // lowercase misses (for example, German sharp-s), while decomposed output
  // matches the normalization-insensitive comparison used by APFS/HFS+.
  if (platform === "win32" && isWindowsAmbiguousPathSegment(value)) {
    throw new Error(
      `Windows runtime resource segment has an ambiguous or reserved spelling: ${value}`,
    );
  }
  const folded = value.toLowerCase().toUpperCase().toLowerCase();
  return platform === "darwin" ? folded.normalize("NFD") : folded;
}

function isWindowsAmbiguousPathSegment(value: string): boolean {
  const base = value.split(".", 1)[0]?.toUpperCase();
  return (
    /[ .]$/u.test(value) ||
    /[<>:"\\|?*\0]/u.test(value) ||
    base === "CON" ||
    base === "PRN" ||
    base === "AUX" ||
    base === "NUL" ||
    /^(?:COM|LPT)[1-9]$/u.test(base ?? "")
  );
}

function assertMissingCandidateIsNotDanglingSymlink(
  candidate: string,
  input: RuntimeResourceLeaseInput,
): void {
  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      throw new Error(
        `Cannot lease runtime resource ${input.resourceLabel}=${input.resourcePath}: ` +
          `dangling symbolic link ${candidate} must be repaired or removed first`,
      );
    }
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

function isSerializedRuntimeResource(
  value: unknown,
): value is SerializedRuntimeResource {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["identities", "resourceLabels", "resourcePath"]) ||
    typeof value.resourcePath !== "string" ||
    value.resourcePath.trim() === "" ||
    value.resourcePath.includes("\0") ||
    !isAbsolute(value.resourcePath) ||
    !Array.isArray(value.resourceLabels) ||
    value.resourceLabels.length === 0 ||
    !value.resourceLabels.every(isValidResourceLabel) ||
    !Array.isArray(value.identities) ||
    value.identities.length === 0
  ) {
    return false;
  }
  return value.identities.every(isCanonicalPathIdentity);
}

function isCanonicalPathIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["anchor", "suffix"]) &&
    typeof value.anchor === "string" &&
    /^(?:0|[1-9]\d*):(?:0|[1-9]\d*)$/u.test(value.anchor) &&
    Array.isArray(value.suffix) &&
    value.suffix.every(isValidPathSegment)
  );
}

function isValidResourceLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.:-]*$/u.test(value)
  );
}

function isValidPathSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    (process.platform === "win32"
      ? !/[\\/\0]/u.test(value) && !isWindowsAmbiguousPathSegment(value)
      : !/[\/\0]/u.test(value))
  );
}

function serializeResource(
  resource: RuntimeProcessLeaseResource,
): SerializedRuntimeResource {
  return {
    identities: resource.identities.map((identity) => ({
      anchor: identity.anchor,
      suffix: [...identity.suffix],
    })),
    resourceLabels: [...resource.resourceLabels],
    resourcePath: resource.resourcePath,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  return arraysEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function isSegmentPrefix(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length <= right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && isSegmentPrefix(left, right);
}

function compareResources(
  left: RuntimeProcessLeaseResource,
  right: RuntimeProcessLeaseResource,
): number {
  const leftKey = JSON.stringify(left.identities);
  const rightKey = JSON.stringify(right.identities);
  return compareStrings(leftKey, rightKey) ||
    compareStrings(left.resourcePath, right.resourcePath);
}

function compareCanonicalIdentities(
  left: CanonicalPathIdentity,
  right: CanonicalPathIdentity,
): number {
  return compareStrings(left.anchor, right.anchor) ||
    compareStrings(JSON.stringify(left.suffix), JSON.stringify(right.suffix));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
