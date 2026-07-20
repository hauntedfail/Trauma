import { createRequire } from "node:module";
import type { Database as BunDatabase } from "bun:sqlite";

const require = createRequire(import.meta.url);

type BunDatabaseConstructor = typeof import("bun:sqlite").Database;

export function loadLeaseDatabaseConstructor(): BunDatabaseConstructor {
  try {
    const sqliteModule = require("bun:sqlite") as typeof import("bun:sqlite");
    return sqliteModule.Database;
  } catch (error) {
    throw new Error(
      `Bun SQLite runtime is required to acquire the TRAUMA runtime lease: ${formatUnknownError(error)}`,
    );
  }
}

export function rollbackLeaseDatabaseQuietly(database: BunDatabase): void {
  try {
    database.run("ROLLBACK;");
  } catch {
    // Closing remains the authoritative lock release.
  }
}

export function closeLeaseDatabase(
  database: BunDatabase | undefined,
): void {
  if (database === undefined) {
    return;
  }
  try {
    database.close();
  } catch {
    // Preserve the acquisition or operation error.
  }
}

export function isSqliteLockError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    ("code" in error &&
      (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")) ||
    /database is (?:busy|locked)/i.test(error.message)
  );
}

export function isErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
