import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import type { Database as BunDatabase } from "bun:sqlite";

import {
  parseRuntimeRootSet,
  resolveRuntimeResourceLeasePlan,
  RUNTIME_COORDINATOR_SCHEMA_VERSION,
  runtimeResourcesOverlap,
} from "./runtime-resource-identity";
import {
  closeLeaseDatabase,
  isErrorWithCode,
  loadLeaseDatabaseConstructor,
} from "./runtime-lease-sqlite";
import type {
  CoordinatorLeaseRow,
  PrivateFileIdentity,
} from "./runtime-lease-coordinator-types";
import type {
  RuntimeLeasePlan,
  RuntimeProcessLeaseResource,
} from "./runtime-lease-types";

const COORDINATOR_BUSY_TIMEOUT_MS = 5_000;
const BIGINT_ONE = BigInt(1);
const BIGINT_ZERO = BigInt(0);
const PRIVATE_FILE_MODE_MASK = BigInt(0o077);
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

let testCoordinatorPath: string | undefined;

export function resolveRuntimeLeaseCoordinatorPath(): string {
  return testCoordinatorPath ?? resolveDefaultRuntimeLeaseCoordinatorPath();
}

export function resolveDefaultRuntimeLeaseCoordinatorPath(): string {
  const accountHome = userInfo().homedir;
  if (accountHome.trim() === "") {
    throw new Error(
      "TRAUMA runtime lease requires an operating-system account home directory",
    );
  }
  return join(
    accountHome,
    ".local",
    "state",
    "trauma",
    "runtime-leases",
    "coordinator.sqlite",
  );
}

export function setRuntimeLeaseCoordinatorPathForTesting(
  path: string,
  temporaryRoot = tmpdir(),
): void {
  testCoordinatorPath = validateTestCoordinatorPath(path, temporaryRoot);
}

export function resetRuntimeLeaseCoordinatorPathForTesting(): void {
  testCoordinatorPath = undefined;
}

function validateTestCoordinatorPath(path: string, temporaryRoot: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || basename(path) !== "coordinator.sqlite") {
    throw new Error(
      "Test runtime coordinator path must be an absolute canonical coordinator.sqlite path",
    );
  }
  if (!isAbsolute(temporaryRoot) || resolve(temporaryRoot) !== temporaryRoot) {
    throw new Error("Test runtime coordinator root must be an absolute path");
  }
  const suppliedParent = dirname(path);
  const suppliedParentStats = lstatSync(suppliedParent);
  if (suppliedParentStats.isSymbolicLink()) {
    throw new Error(
      `Test runtime coordinator parent must not be a symbolic link: ${suppliedParent}`,
    );
  }
  const parent = realpathSync.native(suppliedParent);
  const canonicalTemporaryRoot = realpathSync.native(temporaryRoot);
  const fromTemporaryRoot = relative(canonicalTemporaryRoot, parent);
  if (
    fromTemporaryRoot === "" ||
    fromTemporaryRoot === ".." ||
    fromTemporaryRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromTemporaryRoot)
  ) {
    throw new Error(
      `Test runtime coordinator must use a private directory below ${canonicalTemporaryRoot}`,
    );
  }
  const currentUid = process.getuid?.();
  if (
    !suppliedParentStats.isDirectory() ||
    (currentUid !== undefined && suppliedParentStats.uid !== currentUid) ||
    (currentUid !== undefined && (suppliedParentStats.mode & 0o077) !== 0)
  ) {
    throw new Error(
      `Test runtime coordinator parent must be an owner-only real directory: ${parent}`,
    );
  }
  return path;
}

export function runtimeGuardDirectory(): string {
  return join(dirname(resolveRuntimeLeaseCoordinatorPath()), "guards");
}

export function prepareCoordinatorStorage(): void {
  prepareOwnerOnlyDirectory(dirname(resolveRuntimeLeaseCoordinatorPath()));
  prepareOwnerOnlyDirectory(runtimeGuardDirectory());
}

export function prepareOwnerOnlyDirectory(path: string): void {
  mkdirSync(path, { mode: 0o700, recursive: true });
  const stats = lstatSync(path);
  const currentUid = process.getuid?.();
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (currentUid !== undefined && stats.uid !== currentUid) ||
    (currentUid !== undefined && (stats.mode & 0o077) !== 0)
  ) {
    throw new Error(
      `TRAUMA runtime lease directory must be an owner-only real directory: ${path}`,
    );
  }
}

export function createPrivateFile(path: string): void {
  const descriptor = openSync(path, "wx", 0o600);
  closeSync(descriptor);
  assertOwnerPrivateFile(path);
}

export function assertOwnerPrivateFile(path: string): PrivateFileIdentity {
  const stats = lstatSync(path, { bigint: true });
  const currentUid = process.getuid?.();
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== BIGINT_ONE ||
    (currentUid !== undefined && stats.uid !== BigInt(currentUid)) ||
    (currentUid !== undefined &&
      (stats.mode & PRIVATE_FILE_MODE_MASK) !== BIGINT_ZERO)
  ) {
    throw new Error(
      `TRAUMA runtime lease file must be an owner-only regular file: ${path}`,
    );
  }
  return { dev: stats.dev, ino: stats.ino };
}

export function assertPrivateFileIdentity(
  path: string,
  expected: PrivateFileIdentity,
): void {
  const actual = assertOwnerPrivateFile(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(
      `TRAUMA runtime lease file identity changed while opening: ${path}`,
    );
  }
}

export function openCoordinatorDatabase(): BunDatabase {
  prepareCoordinatorStorage();
  const path = resolveRuntimeLeaseCoordinatorPath();
  let fileIdentity: PrivateFileIdentity;
  try {
    fileIdentity = assertOwnerPrivateFile(path);
  } catch (error) {
    if (!isErrorWithCode(error, "ENOENT")) {
      throw error;
    }
    try {
      createPrivateFile(path);
    } catch (createError) {
      if (!isErrorWithCode(createError, "EEXIST")) {
        throw createError;
      }
    }
    fileIdentity = assertOwnerPrivateFile(path);
  }

  const Database = loadLeaseDatabaseConstructor();
  const database = new Database(path, {
    create: false,
    readwrite: true,
    strict: true,
  });
  try {
    assertPrivateFileIdentity(path, fileIdentity);
    database.run(`PRAGMA busy_timeout = ${COORDINATOR_BUSY_TIMEOUT_MS};`);
    database.run("PRAGMA journal_mode = DELETE;");
    database.run(
      `CREATE TABLE IF NOT EXISTS coordinator_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL
      )`,
    );
    database
      .query(
        "INSERT OR IGNORE INTO coordinator_meta (id, schema_version) VALUES (1, ?1)",
      )
      .run(RUNTIME_COORDINATOR_SCHEMA_VERSION);
    const metadata = database
      .query("SELECT schema_version FROM coordinator_meta WHERE id = 1")
      .get() as { schema_version: number } | undefined;
    if (metadata?.schema_version !== RUNTIME_COORDINATOR_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported TRAUMA runtime coordinator schema version: ${metadata?.schema_version ?? "missing"}`,
      );
    }
    database.run(
      `CREATE TABLE IF NOT EXISTS coordinator_leases (
        lease_id TEXT PRIMARY KEY,
        owner_token TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('runtime', 'migration')),
        guard_path TEXT NOT NULL,
        root_set TEXT NOT NULL,
        display_resources TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        started_at TEXT NOT NULL
      )`,
    );
    return database;
  } catch (error) {
    closeLeaseDatabase(database);
    throw error;
  }
}

export function readCoordinatorRows(): CoordinatorLeaseRow[] {
  const database = openCoordinatorDatabase();
  try {
    return readCoordinatorRowsFrom(database);
  } finally {
    closeLeaseDatabase(database);
  }
}

export function readCoordinatorRowsFrom(
  database: BunDatabase,
): CoordinatorLeaseRow[] {
  return database
    .query(
      "SELECT lease_id, owner_token, purpose, guard_path, root_set, display_resources, owner_pid, started_at FROM coordinator_leases",
    )
    .all() as CoordinatorLeaseRow[];
}

export function readCoordinatorRow(
  database: BunDatabase,
  leaseId: string,
): CoordinatorLeaseRow | undefined {
  return database
    .query(
      "SELECT lease_id, owner_token, purpose, guard_path, root_set, display_resources, owner_pid, started_at FROM coordinator_leases WHERE lease_id = ?1",
    )
    .get(leaseId) as CoordinatorLeaseRow | undefined;
}

export function insertCoordinatorRow(
  database: BunDatabase,
  row: CoordinatorLeaseRow,
): void {
  database
    .query(
      `INSERT INTO coordinator_leases (
        lease_id, owner_token, purpose, guard_path, root_set, display_resources, owner_pid, started_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .run(
      row.lease_id,
      row.owner_token,
      row.purpose,
      row.guard_path,
      row.root_set,
      row.display_resources,
      row.owner_pid,
      row.started_at,
    );
}

export function updateCoordinatorRow(
  database: BunDatabase,
  previousRow: CoordinatorLeaseRow,
  nextRow: CoordinatorLeaseRow,
): void {
  const result = database
    .query(
      `UPDATE coordinator_leases
       SET root_set = ?1, display_resources = ?2
       WHERE lease_id = ?3 AND owner_token = ?4 AND purpose = ?5 AND guard_path = ?6 AND root_set = ?7`,
    )
    .run(
      nextRow.root_set,
      nextRow.display_resources,
      previousRow.lease_id,
      previousRow.owner_token,
      previousRow.purpose,
      previousRow.guard_path,
      previousRow.root_set,
    );
  if (result.changes !== 1) {
    throw new Error(
      "TRAUMA runtime lease transition lost its exact coordinator ownership",
    );
  }
}

export function deleteCoordinatorRow(
  database: BunDatabase,
  row: CoordinatorLeaseRow,
): void {
  const result = database
    .query(
      `DELETE FROM coordinator_leases
       WHERE lease_id = ?1 AND owner_token = ?2 AND purpose = ?3 AND guard_path = ?4 AND root_set = ?5`,
    )
    .run(
      row.lease_id,
      row.owner_token,
      row.purpose,
      row.guard_path,
      row.root_set,
    );
  if (result.changes !== 1) {
    throw new Error(
      "TRAUMA runtime lease coordinator lost its exact lease row",
    );
  }
}

export function assertValidCoordinatorRow(row: CoordinatorLeaseRow): void {
  const rootResources = parseRuntimeRootSet(row.root_set);
  const expectedDisplayResources = JSON.stringify(
    rootResources.map((resource) => ({
      resourceLabels: resource.resourceLabels,
      resourcePath: resource.resourcePath,
    })),
  );
  const startedAtMillis = typeof row.started_at === "string"
    ? Date.parse(row.started_at)
    : Number.NaN;
  if (
    typeof row.lease_id !== "string" ||
    !UUID_PATTERN.test(row.lease_id) ||
    typeof row.owner_token !== "string" ||
    !UUID_PATTERN.test(row.owner_token) ||
    (row.purpose !== "runtime" && row.purpose !== "migration") ||
    !Number.isSafeInteger(row.owner_pid) ||
    row.owner_pid <= 0 ||
    !Number.isFinite(startedAtMillis) ||
    new Date(startedAtMillis).toISOString() !== row.started_at ||
    typeof row.display_resources !== "string" ||
    row.display_resources !== expectedDisplayResources
  ) {
    throw new Error("TRAUMA runtime coordinator contains an invalid lease row");
  }
  assertGuardPath(row.guard_path);
  if (basename(row.guard_path) !== `${row.lease_id}.sqlite`) {
    throw new Error(
      "TRAUMA runtime coordinator guard path is not bound to its lease id",
    );
  }
}

export function assertPlanDoesNotOverlapCoordinatorStorage(
  plan: RuntimeLeasePlan,
): void {
  const coordinatorDirectory = dirname(resolveRuntimeLeaseCoordinatorPath());
  const coordinatorPlan = resolveRuntimeResourceLeasePlan([
    {
      resourceLabel: "runtimeLeaseCoordinator",
      resourcePath: coordinatorDirectory,
    },
    {
      resourceLabel: "runtimeLeaseCoordinatorDatabase",
      resourcePath: resolveRuntimeLeaseCoordinatorPath(),
    },
  ]);
  const overlap = plan.resources.find((resource) =>
    coordinatorPlan.resources.some((coordinatorResource) =>
      runtimeResourcesOverlap(resource, coordinatorResource)
    )
  );
  if (overlap !== undefined) {
    throw new Error(
      `TRAUMA runtime resource ${formatResource(overlap)} overlaps the private ` +
        `runtime lease coordinator at ${coordinatorDirectory}. Choose a ` +
        "projectPath, storePath, and databasePath outside that coordinator tree.",
    );
  }
}

function assertGuardPath(path: string): void {
  const expectedDirectory = resolve(runtimeGuardDirectory());
  const resolvedPath = resolve(path);
  if (
    path !== resolvedPath ||
    dirname(resolvedPath) !== expectedDirectory ||
    !UUID_PATTERN.test(basename(resolvedPath).replace(/\.sqlite$/u, "")) ||
    !basename(resolvedPath).endsWith(".sqlite")
  ) {
    throw new Error(
      `TRAUMA runtime coordinator contains an invalid guard path: ${path}`,
    );
  }
}

function formatResource(resource: RuntimeProcessLeaseResource): string {
  return `${resource.resourceLabels.join("/")}=${resource.resourcePath}`;
}
