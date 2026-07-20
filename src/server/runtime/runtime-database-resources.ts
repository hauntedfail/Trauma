import type { RuntimeResourceLeaseInput } from "./runtime-lease-types";

const SQLITE_RUNTIME_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;

/**
 * SQLite may create sibling files beside the configured database. Treat the
 * primary file and every rollback/WAL sidecar name as one lease family so a
 * second configuration cannot use a sidecar as its own primary database.
 */
export function runtimeDatabaseLeaseInputs(
  databasePath: string,
): RuntimeResourceLeaseInput[] {
  return SQLITE_RUNTIME_SUFFIXES.map((suffix) => ({
    resourceLabel: "databasePath",
    resourcePath: `${databasePath}${suffix}`,
  }));
}
