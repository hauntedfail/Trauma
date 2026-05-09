import { createHash } from "node:crypto";
import type { MigrationMeta } from "drizzle-orm/migrator";

import migration0000Sql from "../../../drizzle/0000_conscious_mikhail_rasputin.sql?raw";

const BUNDLED_MIGRATIONS = [
  {
    sql: migration0000Sql,
    folderMillis: 1778308356677,
    bps: true,
  },
] as const;

export function readBundledMigrations(): MigrationMeta[] {
  return BUNDLED_MIGRATIONS.map((migration) => ({
    sql: migration.sql.split("--> statement-breakpoint"),
    folderMillis: migration.folderMillis,
    hash: createHash("sha256").update(migration.sql).digest("hex"),
    bps: migration.bps,
  }));
}

