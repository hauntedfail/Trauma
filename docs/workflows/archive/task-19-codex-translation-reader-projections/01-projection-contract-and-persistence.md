# Task 19V.01: Projection Contract And Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable data contract for source-to-translated reader projection spans.

**Architecture:** Runtime reads projection spans from SQLite for fast lookup. Translation commit also writes a deterministic sidecar export beside translated `CONTENT.md` so git backup captures the projection artifact with the translated file. The table is canonical for the running app; the sidecar is a backup/export artifact.

**Tech Stack:** TypeScript, Drizzle SQLite schema and migrations, Bun tests, existing translation paths.

---

## Role

Storage and contract owner.

This worker must not change reader rendering or mutation APIs. It creates the projection data model, path helpers, repository methods, and storage tests that downstream workers consume.

## Files

- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/repositories.ts`
- Modify: `src/server/db/bundled-migrations.ts`
- Modify: `src/server/translation/types.ts`
- Modify: `src/server/translation/paths.ts`
- Create: `src/server/translation/projection-map.ts`
- Add migration: `drizzle/0012_translation_projection_spans.sql`
- Add Drizzle snapshot: `drizzle/meta/0012_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `tests/server/translation/translation-projection-map.test.ts`
- Test: `tests/server/translation/translation-repositories.test.ts`
- Test: `tests/server/db/schema.test.ts`

## Data Contract

Add `translation_projection_spans`.

```sql
create table translation_projection_spans (
  job_id text not null references translation_jobs(job_id) on delete cascade,
  span_index integer not null,
  memory_id text not null references memories(id) on delete cascade,
  lang_code text not null,
  source_hash text not null,
  output_hash text not null,
  segment_id text not null,
  block_id text not null,
  source_markdown_start integer not null,
  source_markdown_end integer not null,
  translated_markdown_start integer not null,
  translated_markdown_end integer not null,
  source_reader_start integer not null,
  source_reader_end integer not null,
  translated_reader_start integer not null,
  translated_reader_end integer not null,
  created_at integer not null,
  updated_at integer not null,
  primary key (job_id, span_index),
  check (source_hash glob 'sha256:*'),
  check (output_hash glob 'sha256:*'),
  check (source_markdown_end > source_markdown_start),
  check (translated_markdown_end > translated_markdown_start),
  check (source_reader_end > source_reader_start),
  check (translated_reader_end > translated_reader_start)
);
create index translation_projection_current_idx
  on translation_projection_spans(memory_id, lang_code, source_hash, output_hash, span_index);
```

Add a temporary column to `translation_chunks`:

```sql
alter table translation_chunks add column projection_spans_json text;
```

`projection_spans_json` stores validated chunk-local projection spans only until
final commit. `purgeCompletedTranslationChunks()` must clear it together with
`translated_markdown`.

Add this TypeScript shape to `src/server/translation/types.ts`:

```ts
export interface TranslationProjectionSpan {
  jobId: string;
  spanIndex: number;
  memoryId: string;
  langCode: SupportedLanguageCode;
  sourceHash: string;
  outputHash: string;
  segmentId: string;
  blockId: string;
  sourceMarkdownStart: number;
  sourceMarkdownEnd: number;
  translatedMarkdownStart: number;
  translatedMarkdownEnd: number;
  sourceReaderStart: number;
  sourceReaderEnd: number;
  translatedReaderStart: number;
  translatedReaderEnd: number;
  createdAt: Date;
  updatedAt: Date;
}
```

Add this sidecar path helper to `src/server/translation/paths.ts`:

```ts
export function resolveTranslatedMemoryProjectionPath(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode: string;
  memoryId: string;
}) {
  const contentPath = resolveTranslatedMemoryContentPath(input);
  return {
    absolutePath: join(dirname(contentPath.absolutePath), "TRANSLATION_MAP.json"),
    relativePath: posix.join("memories", input.memoryId, input.langCode, "TRANSLATION_MAP.json"),
  };
}
```

## Task Steps

- [ ] **Step 1: Write repository and path tests**

Add tests that assert:

```ts
expect(resolveTranslatedMemoryProjectionPath({
  config,
  memoryId,
  langCode: "ja-JP",
}).relativePath).toBe(`memories/${memoryId}/ja-JP/TRANSLATION_MAP.json`);
```

Add repository tests that insert two projection spans and read them back by `(memoryId, langCode, sourceHash, outputHash)`.

- [ ] **Step 2: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-projection-map.test.ts tests/server/translation/translation-repositories.test.ts tests/server/db/schema.test.ts
```

Expected: FAIL because projection paths, schema, and repository methods do not exist.

- [ ] **Step 3: Add schema and migration**

Add `translationProjectionSpans` to `src/server/db/schema.ts` with the SQL constraints above. Generate or hand-maintain the Drizzle migration and metadata following the current migration style.

- [ ] **Step 4: Add repository methods**

Add these methods to the translation repository:

```ts
replaceProjectionSpansForJob(jobId: string, spans: TranslationProjectionSpan[]): Promise<void>;
listCurrentProjectionSpans(input: {
  memoryId: string;
  langCode: SupportedLanguageCode;
  sourceHash: string;
  outputHash: string;
}): Promise<TranslationProjectionSpan[]>;
deleteProjectionSpansForJob(jobId: string): Promise<void>;
```

`replaceProjectionSpansForJob` must delete previous rows for the job and insert the next set in one SQLite transaction.

- [ ] **Step 5: Add sidecar serializer**

Create `src/server/translation/projection-map.ts` with:

```ts
export interface TranslationProjectionSidecar {
  version: 1;
  jobId: string;
  memoryId: string;
  langCode: SupportedLanguageCode;
  sourceHash: string;
  outputHash: string;
  spans: TranslationProjectionSpan[];
}
```

Add `serializeTranslationProjectionSidecar()` that emits stable pretty JSON with spans sorted by `spanIndex`.

- [ ] **Step 6: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-projection-map.test.ts tests/server/translation/translation-repositories.test.ts tests/server/db/schema.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Downstream workers can persist and query current projection spans by memory, language, source hash, and output hash. The projection table is durable runtime state; the sidecar JSON is the backup artifact.
