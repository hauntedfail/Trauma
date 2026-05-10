import type { Database as BunDatabase } from "bun:sqlite";

import { readBundledMigrations } from "./bundled-migrations";

interface AppliedMigrationRow {
  created_at: number;
  hash: string;
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
  const appliedMigrationByCreatedAt = new Map(
    appliedMigrations.map((migration) => [migration.created_at, migration]),
  );
  const bundledMigrations = readBundledMigrations();
  const bundledMigrationByCreatedAt = new Map(
    bundledMigrations.map((migration) => [migration.folderMillis, migration]),
  );

  for (const appliedMigration of appliedMigrations) {
    if (!bundledMigrationByCreatedAt.has(appliedMigration.created_at)) {
      throw new Error(
        `Database has an unknown or newer bundled migration: ${appliedMigration.created_at}. ` +
          "Run this database with a runtime that includes that migration.",
      );
    }
  }

  for (const migration of bundledMigrations) {
    const appliedMigration = appliedMigrationByCreatedAt.get(migration.folderMillis);
    if (appliedMigration !== undefined) {
      if (appliedMigration.hash !== migration.hash) {
        throw new Error(
          `Bundled migration hash mismatch for ${migration.folderMillis}. ` +
            "The local database was migrated with different SQL.",
        );
      }
      continue;
    }

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
    "Bundled migration introduced or preserved foreign key violations: " +
      `table=${firstViolation.table}, rowid=${firstViolation.rowid ?? "unknown"}, ` +
      `parent=${firstViolation.parent}, fkid=${firstViolation.fkid}`,
  );
}

function recordMigration(sqlite: BunDatabase, hash: string, folderMillis: number) {
  sqlite
    .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`)
    .run(hash, folderMillis);
}
