import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Database as BunDatabase } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type { ResolvedTraumaConfig } from "../config";
import { applyBundledMigrations } from "./migrations";
import { createRepositories, type TraumaRepositories } from "./repositories";
import * as schema from "./schema";

const require = createRequire(import.meta.url);

type BunDatabaseConstructor = typeof import("bun:sqlite").Database;

export interface TraumaDatabaseConnection {
  sqlite: BunDatabase;
  db: BunSQLiteDatabase<typeof schema>;
  repositories: TraumaRepositories;
  close: () => void;
}

export interface InitializeDatabaseOptions {
  migrationsFolder?: string;
  runMigrations?: boolean;
}

export function initializeDatabase(
  config: ResolvedTraumaConfig,
  options: InitializeDatabaseOptions = {},
): TraumaDatabaseConnection {
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const Database = loadDatabaseConstructor();
  const sqlite = new Database(config.databasePath, { create: true });
  try {
    sqlite.run("PRAGMA foreign_keys = ON;");
    sqlite.run("PRAGMA journal_mode = WAL;");

    const db = createDrizzleDatabase(sqlite);
    if (options.runMigrations !== false) {
      applyMigrations(sqlite, db, options.migrationsFolder);
    }

    return {
      sqlite,
      db,
      repositories: createRepositories(db),
      close: () => sqlite.close(),
    };
  } catch (error) {
    try {
      sqlite.close();
    } catch {
      // Preserve the original initialization error.
    }

    throw error;
  }
}

function loadDatabaseConstructor(): BunDatabaseConstructor {
  try {
    const sqliteModule = require("bun:sqlite") as typeof import("bun:sqlite");
    return sqliteModule.Database;
  } catch (error) {
    throw new Error(
      `Bun SQLite runtime is required to initialize Trauma database: ${formatUnknownError(error)}`,
    );
  }
}

function createDrizzleDatabase(sqlite: BunDatabase) {
  const { drizzle } = require("drizzle-orm/bun-sqlite") as typeof import("drizzle-orm/bun-sqlite");
  return drizzle({ client: sqlite, schema });
}

function applyMigrations(
  sqlite: BunDatabase,
  db: BunSQLiteDatabase<typeof schema>,
  migrationsFolder?: string,
) {
  const { migrate } = require("drizzle-orm/bun-sqlite/migrator") as typeof import("drizzle-orm/bun-sqlite/migrator");
  if (migrationsFolder !== undefined) {
    migrate(db, { migrationsFolder });
    return;
  }

  applyBundledMigrations(sqlite);
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
