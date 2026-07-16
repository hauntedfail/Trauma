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
import migration0010Sql from "../../../drizzle/0010_brilliant_translation_jobs.sql?raw";
import migration0011Sql from "../../../drizzle/0011_numerous_arclight.sql?raw";
import migration0012Sql from "../../../drizzle/0012_translation_projection_spans.sql?raw";
import migration0013Sql from "../../../drizzle/0013_variant_local_flashbacks.sql?raw";
import migration0014Sql from "../../../drizzle/0014_strict_flashback_variant_scope.sql?raw";
import migration0015Sql from "../../../drizzle/0015_memory_browse_pagination.sql?raw";
import migration0016Sql from "../../../drizzle/0016_scrub_backup_secrets.sql?raw";
import migration0017Sql from "../../../drizzle/0017_skinny_hobgoblin.sql?raw";
import migration0018Sql from "../../../drizzle/0018_scrub_backup_diagnostics.sql?raw";
import migration0019Sql from "../../../drizzle/0019_memory_creation_idempotency.sql?raw";
import migration0020Sql from "../../../drizzle/0020_nasty_kulan_gath.sql?raw";
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
  {
    sql: migration0010Sql,
    folderMillis: 1779412761000,
    bps: true,
  },
  {
    sql: migration0011Sql,
    folderMillis: 1779441939597,
    bps: true,
  },
  {
    sql: migration0012Sql,
    folderMillis: 1779445000000,
    bps: true,
  },
  {
    sql: migration0013Sql,
    folderMillis: 1779449000000,
    bps: true,
  },
  {
    sql: migration0014Sql,
    folderMillis: 1779449500000,
    bps: true,
  },
  {
    sql: migration0015Sql,
    folderMillis: 1779955000000,
    bps: true,
  },
  {
    sql: migration0016Sql,
    folderMillis: 1784221790920,
    bps: true,
  },
  {
    sql: migration0017Sql,
    folderMillis: 1784223792512,
    bps: true,
  },
  {
    sql: migration0018Sql,
    folderMillis: 1784232000000,
    bps: true,
  },
  {
    sql: migration0019Sql,
    folderMillis: 1784234421333,
    bps: true,
  },
  {
    sql: migration0020Sql,
    folderMillis: 1784238332412,
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
