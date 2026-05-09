import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type { ResolvedTraumaConfig } from "../config";
import { createRepositories, type TraumaRepositories } from "./repositories";
import * as schema from "./schema";

const require = createRequire(import.meta.url);
const DEFAULT_MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "drizzle",
);

interface SQLiteDatabase {
  close: () => void;
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all?: (...params: unknown[]) => unknown[];
    run?: (...params: unknown[]) => unknown;
  };
}

export interface TraumaDatabaseConnection {
  sqlite: SQLiteDatabase;
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
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");

  const db = createDrizzleDatabase(sqlite);
  if (options.runMigrations !== false) {
    applyMigrations(db, options.migrationsFolder);
  }

  return {
    sqlite,
    db,
    repositories: createRepositories(db),
    close: () => sqlite.close(),
  };
}

function loadDatabaseConstructor() {
  try {
    return require("bun:sqlite").Database as new (
      path: string,
      options: { create: boolean },
    ) => SQLiteDatabase;
  } catch (error) {
    throw new Error(
      `Bun SQLite runtime is required to initialize Trauma database: ${formatUnknownError(error)}`,
    );
  }
}

function createDrizzleDatabase(sqlite: SQLiteDatabase) {
  const { drizzle } = require("drizzle-orm/bun-sqlite") as typeof import("drizzle-orm/bun-sqlite");
  return drizzle(sqlite as never, { schema });
}

function applyMigrations(
  db: BunSQLiteDatabase<typeof schema>,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
) {
  const { migrate } = require("drizzle-orm/bun-sqlite/migrator") as typeof import("drizzle-orm/bun-sqlite/migrator");
  migrate(db, { migrationsFolder });
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
