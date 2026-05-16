import { createHash } from "node:crypto";

import migration0000Sql from "../../../drizzle/0000_conscious_mikhail_rasputin.sql?raw";
import migration0001Sql from "../../../drizzle/0001_cold_shotgun.sql?raw";
import migration0002Sql from "../../../drizzle/0002_chilly_james_howlett.sql?raw";
import migration0003Sql from "../../../drizzle/0003_backup_environment_failsafe.sql?raw";
import migration0004Sql from "../../../drizzle/0004_perfect_galactus.sql?raw";
import migration0005Sql from "../../../drizzle/0005_pretty_colossus.sql?raw";
import migration0006Sql from "../../../drizzle/0006_sweet_zuras.sql?raw";
import migration0007Sql from "../../../drizzle/0007_empty_starbolt.sql?raw";
import migration0008Sql from "../../../drizzle/0008_long_slipstream.sql?raw";
import migration0009Sql from "../../../drizzle/0009_product_language_migration.sql?raw";
import type { RuntimeMigration } from "./migrations";

const BUNDLED_MIGRATIONS = [
  {
    sql: migration0000Sql,
    folderMillis: 1778308356677,
    bps: true,
  },
  {
    sql: migration0001Sql,
    folderMillis: 1778393646543,
    bps: true,
  },
  {
    sql: migration0002Sql,
    folderMillis: 1778418914933,
    bps: true,
  },
  {
    sql: migration0003Sql,
    folderMillis: 1778606982293,
    bps: true,
  },
  {
    sql: migration0004Sql,
    folderMillis: 1778682602024,
    bps: true,
  },
  {
    sql: migration0005Sql,
    folderMillis: 1778858393843,
    bps: true,
  },
  {
    sql: migration0006Sql,
    folderMillis: 1778864600344,
    bps: true,
  },
  {
    sql: migration0007Sql,
    folderMillis: 1778868234166,
    bps: true,
  },
  {
    sql: migration0008Sql,
    folderMillis: 1778889992720,
    bps: true,
  },
  {
    sql: migration0009Sql,
    folderMillis: 1778934734173,
    bps: true,
  },
] as const;

export function readBundledMigrations(): RuntimeMigration[] {
  return BUNDLED_MIGRATIONS.map((migration) => ({
    sql: migration.sql.split("--> statement-breakpoint"),
    folderMillis: migration.folderMillis,
    hash: createHash("sha256").update(migration.sql).digest("hex"),
    bps: migration.bps,
  }));
}
