import type { Database as BunDatabase } from "bun:sqlite";

import { readBundledMigrations } from "./bundled-migrations";

interface AppliedMigrationRow {
  created_at: number;
}

const MIGRATIONS_TABLE = "__drizzle_migrations";

export function applyBundledMigrations(sqlite: BunDatabase): void {
  sqlite.run(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id integer primary key autoincrement,
      hash text NOT NULL,
      created_at numeric
    )`,
  );

  const lastMigration = sqlite
    .query<AppliedMigrationRow, []>(
      `SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`,
    )
    .get();
  const lastAppliedAt = lastMigration?.created_at ?? Number.NEGATIVE_INFINITY;

  for (const migration of readBundledMigrations()) {
    if (lastAppliedAt >= migration.folderMillis) {
      continue;
    }

    if (migration.bps) {
      applyStatements(sqlite, migration.sql);
      recordMigration(sqlite, migration.hash, migration.folderMillis);
      continue;
    }

    const apply = sqlite.transaction(() => {
      applyStatements(sqlite, migration.sql);
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

function recordMigration(sqlite: BunDatabase, hash: string, folderMillis: number) {
  sqlite
    .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`)
    .run(hash, folderMillis);
}
