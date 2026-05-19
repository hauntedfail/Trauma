# 19.2 Translation storage and database foundation

## Goal

Add storage and database foundations for translated memory content.

This subtask does not run Codex and does not add reader UI.

## Files likely owned

- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `src/server/store/memory-content.ts`
- `src/server/store/translated-memory-content.ts`
- `tests/server/db/schema.test.ts`
- `tests/server/db/repositories.test.ts`
- `tests/server/store/translated-memory-content.test.ts`

## Directory contract

Source content remains:

```text
{storePath}/memories/{memoryId}/CONTENT.md
```

Translated content:

```text
{storePath}/memories/{memoryId}/{langCode}/CONTENT.md
```

Example:

```text
{storePath}/memories/018f04a2-.../ja-JP/CONTENT.md
```

Rules:

- `langCode` must be a supported BCP 47 language code.
- Japanese is `ja-JP`.
- Do not overwrite source `CONTENT.md`.
- Do not store translated content outside the memory directory.
- Validate path traversal before writing.

## Database contract

Add a translations table:

```ts
memoryTranslations: {
  id: string;
  memoryId: string;
  languageCode: string;
  contentPath: string;
  status: "pending" | "translating" | "success" | "failed";
  sourceContentHash: string;
  translatedContentHash: string | null;
  provider: "codex";
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- `memoryId` references `memories.id` with cascade delete.
- Unique key: `(memoryId, languageCode)`.
- `contentPath` is relative to `storePath`.
- `sourceContentHash` detects stale translations when source `CONTENT.md` changes.
- `status` tracks translation lifecycle.

## Translated `CONTENT.md` frontmatter

Translated `CONTENT.md` should include enough metadata to be self-describing:

```yaml
id: "<memoryId>"
source_memory_id: "<memoryId>"
url: "<source url>"
title: "<translated or source title>"
captured_at: "<source captured_at>"
extraction_status: "success"
translation_language: "ja-JP"
translation_provider: "codex"
source_content_hash: "<hash>"
translated_at: "<ISO timestamp>"
```

Rules:

- Do not mutate source frontmatter.
- Keep translated file parsing separate from source memory parsing if the existing parser is too strict.
- Preserve Markdown structure as much as possible.

## Tests

Cover:

- path resolution for `{memoryId}/{langCode}/CONTENT.md`
- rejects path traversal language codes
- writes translated content without overwriting source
- parses translated frontmatter
- translation table unique constraint
- memory deletion cascades translation metadata
- translated content file remains within `storePath`

## Verification

```sh
mise exec -- bun run test tests/server/store/translated-memory-content.test.ts
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/db/repositories.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Translation storage is deterministic.
- SQLite can track translation status.
- Source `CONTENT.md` remains untouched.

