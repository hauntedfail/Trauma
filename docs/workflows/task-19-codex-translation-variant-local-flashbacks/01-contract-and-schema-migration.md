# Task 19W.01: Contract And Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add variant identity to `flashbacks` while migrating existing rows to the source variant.

**Architecture:** Rebuild the existing `flashbacks` table with three variant columns and a cross-column check. Existing data copies into `variant_kind = 'source'`. Drizzle schema, bundled migrations, and schema tests stay in lockstep.

**Tech Stack:** Drizzle SQLite schema, Bun SQLite runtime migrations, Vitest schema/repository tests.

---

## Role

Schema owner.

This worker must not change API routes, reader rendering, or Flashback toggle logic.

## Files

- Create: `drizzle/0013_variant_local_flashbacks.sql`
- Create: `drizzle/meta/0013_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/bundled-migrations.ts`
- Test: `tests/server/db/schema.test.ts`
- Test: `tests/server/flashbacks/repository.test.ts`

## Schema Contract

Add:

```ts
variantKind: text("variant_kind")
  .$type<"source" | "translation">()
  .notNull()
  .default("source"),
langCode: text("lang_code").$type<SupportedLanguageCode>(),
translationOutputHash: text("translation_output_hash"),
```

Add checks:

```ts
check(
  "flashbacks_variant_kind_check",
  sql`${table.variantKind} in ('source', 'translation')`,
),
check(
  "flashbacks_variant_scope_check",
  sql`(${table.variantKind} = 'source' and ${table.langCode} is null and ${table.translationOutputHash} is null) or (${table.variantKind} = 'translation' and ${table.langCode} in (${supportedLanguageSqlList}) and ${table.translationOutputHash} glob 'sha256:*')`,
),
```

Add index:

```ts
index("flashbacks_memory_variant_idx").on(
  table.memoryId,
  table.variantKind,
  table.langCode,
  table.translationOutputHash,
  table.startOffset,
),
```

## Migration SQL

Create `drizzle/0013_variant_local_flashbacks.sql` in the current migration style:

```sql
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_flashbacks` (
  `id` text PRIMARY KEY NOT NULL,
  `memory_id` text NOT NULL,
  `variant_kind` text DEFAULT 'source' NOT NULL,
  `lang_code` text,
  `translation_output_hash` text,
  `text` text NOT NULL,
  `prefix` text NOT NULL,
  `suffix` text NOT NULL,
  `start_offset` integer NOT NULL,
  `end_offset` integer NOT NULL,
  `content_hash` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "flashbacks_variant_kind_check" CHECK(`variant_kind` in ('source', 'translation')),
  CONSTRAINT "flashbacks_variant_scope_check" CHECK((`variant_kind` = 'source' and `lang_code` is null and `translation_output_hash` is null) or (`variant_kind` = 'translation' and `lang_code` in ('ja-JP') and `translation_output_hash` glob 'sha256:*')),
  CONSTRAINT "flashbacks_start_offset_check" CHECK(`start_offset` >= 0),
  CONSTRAINT "flashbacks_end_offset_check" CHECK(`end_offset` > `start_offset`)
);
--> statement-breakpoint
INSERT INTO `__new_flashbacks` (
  `id`,
  `memory_id`,
  `variant_kind`,
  `lang_code`,
  `translation_output_hash`,
  `text`,
  `prefix`,
  `suffix`,
  `start_offset`,
  `end_offset`,
  `content_hash`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `memory_id`,
  'source',
  NULL,
  NULL,
  `text`,
  `prefix`,
  `suffix`,
  `start_offset`,
  `end_offset`,
  `content_hash`,
  `created_at`,
  `updated_at`
FROM `flashbacks`;
--> statement-breakpoint
DROP TABLE `flashbacks`;
--> statement-breakpoint
ALTER TABLE `__new_flashbacks` RENAME TO `flashbacks`;
--> statement-breakpoint
CREATE INDEX `flashbacks_memory_id_idx` ON `flashbacks` (`memory_id`);
--> statement-breakpoint
CREATE INDEX `flashbacks_created_at_idx` ON `flashbacks` (`created_at`);
--> statement-breakpoint
CREATE INDEX `flashbacks_memory_variant_idx` ON `flashbacks` (`memory_id`,`variant_kind`,`lang_code`,`translation_output_hash`,`start_offset`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
```

If supported languages expand before this task runs, replace the hard-coded SQL list with the generated list from current schema output.

## Task Steps

- [ ] **Step 1: Write migration compatibility test**

Add a test in `tests/server/db/schema.test.ts` that creates a database through migrations before `0013`, inserts one legacy Flashback, applies all bundled migrations, and asserts:

```ts
expect(row).toMatchObject({
  id: "existing-flashback",
  variantKind: "source",
  langCode: null,
  translationOutputHash: null,
});
```

- [ ] **Step 2: Write constraint tests**

Add assertions that SQLite rejects:

```sql
insert into flashbacks (..., variant_kind, lang_code, translation_output_hash, ...)
values (..., 'source', 'ja-JP', 'sha256:abc', ...);
```

and rejects:

```sql
insert into flashbacks (..., variant_kind, lang_code, translation_output_hash, ...)
values (..., 'translation', null, null, ...);
```

Expected errors contain `flashbacks_variant_scope_check`.

- [ ] **Step 3: Verify RED**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/db/schema.test.ts tests/server/flashbacks/repository.test.ts
```

Expected: FAIL because the current schema has no variant columns.

- [ ] **Step 4: Add schema fields and migration**

Update `src/server/db/schema.ts`, add `drizzle/0013_variant_local_flashbacks.sql`, generate or hand-maintain `drizzle/meta/0013_snapshot.json`, and append a journal entry in `drizzle/meta/_journal.json`.

- [ ] **Step 5: Bundle the migration**

Update `src/server/db/bundled-migrations.ts`:

```ts
import migration0013Sql from "../../../drizzle/0013_variant_local_flashbacks.sql?raw";
```

Append:

```ts
{
  sql: migration0013Sql,
  folderMillis: 1779449000000,
  bps: true,
},
```

- [ ] **Step 6: Verify this slice**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/db/schema.test.ts tests/server/flashbacks/repository.test.ts
git diff --check
```

Expected: all commands pass.

## Handoff

The database exposes variant-aware Flashback columns. Existing data is source-scoped. No runtime code has started reading or writing translated Flashbacks yet.
