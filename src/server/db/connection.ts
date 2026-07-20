import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Database as BunDatabase } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type { ResolvedTraumaConfig } from "../config";
import {
  acquireDatabaseInitializationLease,
  borrowRuntimeProcessLeaseForResources,
  runtimeLeaseInputsForConfig,
} from "../runtime/process-lease";
import { applyBundledMigrations, applyRuntimeMigrations } from "./migrations";
import { createRepositories, type TraumaRepositories } from "./repositories";
import * as schema from "./schema";

const require = createRequire(import.meta.url);
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

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
  const databasePath = config.databasePath;
  const projectPath = config.projectPath;
  const storePath = config.storePath;
  const fixedConfig: ResolvedTraumaConfig = {
    backup: config.backup,
    configFilePath: config.configFilePath,
    databasePath,
    projectPath,
    storePath,
  };
  const runtimeLeaseInputs = runtimeLeaseInputsForConfig(fixedConfig);
  const runtimeLeaseBorrow = borrowRuntimeProcessLeaseForResources(
    runtimeLeaseInputs,
  );
  const initializationLease = runtimeLeaseBorrow !== undefined
    ? undefined
    : acquireDatabaseInitializationLease(fixedConfig);
  let openedDatabase: BunDatabase | undefined;
  let connectionOwnsLease = false;
  let retainLease = false;
  try {
    // No filesystem mutation occurs before either a covering in-process
    // runtime lease or a standalone initialization lease is held.
    initializationLease?.refresh();
    runtimeLeaseBorrow?.assertCovers(runtimeLeaseInputs);
    mkdirSync(dirname(databasePath), { recursive: true });
    const databaseDescriptor = openSync(databasePath, "a", 0o600);
    closeSync(databaseDescriptor);
    initializationLease?.refresh();
    runtimeLeaseBorrow?.assertCovers(runtimeLeaseInputs);

    const Database = loadDatabaseConstructor();
    const sqlite = new Database(databasePath, { create: true });
    openedDatabase = sqlite;
    sqlite.run("PRAGMA foreign_keys = ON;");
    sqlite.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
    sqlite.run("PRAGMA journal_mode = WAL;");
    materializeWalSidecars(sqlite, databasePath);
    initializationLease?.refresh();
    runtimeLeaseBorrow?.assertCovers(runtimeLeaseInputs);

    const db = createDrizzleDatabase(sqlite);
    if (options.runMigrations !== false) {
      applyMigrations(sqlite, options.migrationsFolder);
    }
    initializationLease?.refresh();
    runtimeLeaseBorrow?.assertCovers(runtimeLeaseInputs);

    const repositories = createRepositories(db);

    let sqliteClosed = false;
    let ownershipReleased = false;
    const close = () => {
      if (sqliteClosed && ownershipReleased) {
        return;
      }
      // Do not release cross-process ownership unless SQLite confirms that the
      // protected handle closed. A failed close remains retryable and keeps the
      // process-exit cleanup as the final fail-closed boundary.
      if (!sqliteClosed) {
        sqlite.close();
        sqliteClosed = true;
      }
      if (!ownershipReleased) {
        initializationLease?.release();
        runtimeLeaseBorrow?.release();
        ownershipReleased = true;
      }
    };
    // Transfer ownership only after every return field has been constructed.
    connectionOwnsLease = true;

    return {
      sqlite,
      db,
      repositories,
      close,
    };
  } catch (error) {
    try {
      openedDatabase?.close();
    } catch {
      // Preserve the original initialization error, but retain the lease until
      // process exit because the database handle may still be live.
      retainLease = true;
    }

    throw error;
  } finally {
    if (!connectionOwnsLease && !retainLease) {
      initializationLease?.release();
      runtimeLeaseBorrow?.release();
    }
  }
}

function materializeWalSidecars(
  sqlite: BunDatabase,
  databasePath: string,
): void {
  if (existsSync(`${databasePath}-wal`) && existsSync(`${databasePath}-shm`)) {
    return;
  }

  // Merely selecting WAL mode does not create the sidecars on a fresh
  // database. Materialize them while initialization ownership is held so the
  // next lease refresh records their inode identities before callers can
  // write or expose a hardlink alias.
  sqlite.run("BEGIN IMMEDIATE;");
  sqlite.run("ROLLBACK;");
  if (!existsSync(`${databasePath}-wal`) || !existsSync(`${databasePath}-shm`)) {
    throw new Error(
      `Failed to materialize SQLite WAL sidecars for ${databasePath}`,
    );
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
  migrationsFolder?: string,
) {
  if (migrationsFolder !== undefined) {
    const { readMigrationFiles } = require("drizzle-orm/migrator") as typeof import("drizzle-orm/migrator");
    applyRuntimeMigrations(
      sqlite,
      readMigrationFiles({ migrationsFolder }),
      "explicit-folder",
    );
    return;
  }

  applyBundledMigrations(sqlite);
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
