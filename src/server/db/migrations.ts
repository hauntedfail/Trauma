import type { Database as BunDatabase } from "bun:sqlite";

import { readBundledMigrations } from "./bundled-migrations";

interface AppliedMigrationRow {
  created_at: number;
  hash: string;
}

export interface RuntimeMigration {
  sql: string[];
  folderMillis: number;
  hash: string;
  bps: boolean;
}

interface ForeignKeyViolationRow {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

const MIGRATIONS_TABLE = "__drizzle_migrations";
const FOREIGN_KEYS_PRAGMA_PATTERN = /^PRAGMA\s+foreign_keys\s*=\s*(ON|OFF|1|0)\s*;?$/i;

export function applyBundledMigrations(sqlite: BunDatabase): void {
  applyRuntimeMigrations(sqlite, readBundledMigrations(), "bundled");
}

export function applyRuntimeMigrations(
  sqlite: BunDatabase,
  runtimeMigrations: RuntimeMigration[],
  sourceLabel = "runtime",
): void {
  validateRuntimeMigrationManifest(runtimeMigrations, sourceLabel);

  sqlite.run(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id integer primary key autoincrement,
      hash text NOT NULL,
      created_at numeric
    )`,
  );

  const appliedMigrations = sqlite
    .query<AppliedMigrationRow, []>(
      `SELECT created_at, hash FROM ${MIGRATIONS_TABLE} ORDER BY created_at ASC`,
    )
    .all();
  validateAppliedMigrationHistory(appliedMigrations, runtimeMigrations, sourceLabel);

  for (const migration of runtimeMigrations.slice(appliedMigrations.length)) {
    if (migration.bps) {
      applyBreakpointedMigration(sqlite, migration.sql, () => {
        recordMigration(sqlite, migration.hash, migration.folderMillis);
      });
      continue;
    }

    const apply = sqlite.transaction(() => {
      applyStatements(sqlite, migration.sql);
      assertNoForeignKeyViolations(sqlite);
      recordMigration(sqlite, migration.hash, migration.folderMillis);
    });

    apply();
  }
}

function validateRuntimeMigrationManifest(
  runtimeMigrations: RuntimeMigration[],
  sourceLabel: string,
): void {
  let previousFolderMillis: number | undefined;

  for (const migration of runtimeMigrations) {
    if (
      !Number.isSafeInteger(migration.folderMillis) ||
      (previousFolderMillis !== undefined &&
        migration.folderMillis <= previousFolderMillis)
    ) {
      throw new Error(
        `${sourceLabel} migration manifest must have unique, strictly increasing folderMillis values. ` +
          `Found ${migration.folderMillis} after ${previousFolderMillis ?? "the start"}.`,
      );
    }

    previousFolderMillis = migration.folderMillis;
  }
}

function validateAppliedMigrationHistory(
  appliedMigrations: AppliedMigrationRow[],
  runtimeMigrations: RuntimeMigration[],
  sourceLabel: string,
): void {
  const runtimeMigrationByCreatedAt = new Map(
    runtimeMigrations.map((migration) => [migration.folderMillis, migration]),
  );

  for (const appliedMigration of appliedMigrations) {
    if (!runtimeMigrationByCreatedAt.has(appliedMigration.created_at)) {
      throw new Error(
        `Database has an unknown or newer ${sourceLabel} migration: ${appliedMigration.created_at}. ` +
          "Run this database with a runtime that includes that migration.",
      );
    }
  }

  const seenCreatedAt = new Set<number>();
  for (const appliedMigration of appliedMigrations) {
    if (seenCreatedAt.has(appliedMigration.created_at)) {
      throw new Error(
        `Database has a duplicate ${sourceLabel} migration record: ${appliedMigration.created_at}. ` +
          "Applied migrations must form a contiguous prefix of the runtime migrations.",
      );
    }
    seenCreatedAt.add(appliedMigration.created_at);
  }

  for (const [index, appliedMigration] of appliedMigrations.entries()) {
    const expectedMigration = runtimeMigrations[index];
    if (
      expectedMigration === undefined ||
      appliedMigration.created_at !== expectedMigration.folderMillis
    ) {
      throw new Error(
        `${sourceLabel} migration history gap before ${appliedMigration.created_at}. ` +
          `Expected migration ${expectedMigration?.folderMillis ?? "none"}; ` +
          "applied migrations must form a contiguous prefix of the runtime migrations.",
      );
    }

    if (appliedMigration.hash !== expectedMigration.hash) {
      throw new Error(
        `${sourceLabel} migration hash mismatch for ${expectedMigration.folderMillis}. ` +
          "The local database was migrated with different SQL.",
      );
    }
  }
}

function applyStatements(sqlite: BunDatabase, statements: string[]) {
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed !== "") {
      sqlite.run(trimmed);
    }
  }
}

function applyBreakpointedMigration(
  sqlite: BunDatabase,
  statements: string[],
  recordAppliedMigration: () => void,
) {
  // SQLite ignores foreign_keys changes inside transactions. Generated table
  // rebuild migrations must pair any OFF directive with a later ON directive so
  // desiredForeignKeysState restores enforcement after the migration commits.
  const originalForeignKeysState = readForeignKeysState(sqlite);
  let desiredForeignKeysState = originalForeignKeysState;
  let migrationCompleted = false;
  const ordinaryStatements: string[] = [];

  try {
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (trimmed === "") {
        continue;
      }

      const foreignKeysPragma = parseForeignKeysPragma(trimmed);
      if (foreignKeysPragma !== undefined) {
        desiredForeignKeysState = foreignKeysPragma;
        if (!foreignKeysPragma) {
          sqlite.run(trimmed);
        }
        continue;
      }

      ordinaryStatements.push(trimmed);
    }

    const apply = sqlite.transaction(() => {
      applyStatements(sqlite, ordinaryStatements);
      assertNoForeignKeyViolations(sqlite);
      recordAppliedMigration();
    });
    apply();
    migrationCompleted = true;
  } finally {
    const foreignKeysState = migrationCompleted
      ? desiredForeignKeysState
      : originalForeignKeysState;
    sqlite.run(`PRAGMA foreign_keys = ${foreignKeysState ? "ON" : "OFF"}`);
  }
}

function parseForeignKeysPragma(statement: string) {
  const match = statement.match(FOREIGN_KEYS_PRAGMA_PATTERN);
  if (match === null) {
    return undefined;
  }

  return match[1]?.toUpperCase() === "ON" || match[1] === "1";
}

function readForeignKeysState(sqlite: BunDatabase) {
  const row = sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
  return row?.foreign_keys === 1;
}

function assertNoForeignKeyViolations(sqlite: BunDatabase) {
  const violations = sqlite
    .query<ForeignKeyViolationRow, []>("PRAGMA foreign_key_check")
    .all();
  if (violations.length === 0) {
    return;
  }

  const [firstViolation] = violations;
  if (firstViolation === undefined) {
    return;
  }

  throw new Error(
    "Runtime migration introduced or preserved foreign key violations: " +
      `table=${firstViolation.table}, rowid=${firstViolation.rowid ?? "unknown"}, ` +
      `parent=${firstViolation.parent}, fkid=${firstViolation.fkid}`,
  );
}

function recordMigration(sqlite: BunDatabase, hash: string, folderMillis: number) {
  sqlite
    .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`)
    .run(hash, folderMillis);
}
