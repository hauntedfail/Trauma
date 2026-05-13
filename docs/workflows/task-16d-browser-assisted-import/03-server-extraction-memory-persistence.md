# Task 16d.3: Server Extraction And Memory Persistence

## Goal

Convert a validated browser-captured HTML snapshot into a normal TRAUMA memory
through the existing server-owned extraction and store path.

## Ownership

Primary files:

- Create: `src/server/browser-import/import-browser-capture.ts`
- Modify: `src/routes/api/browser-import.ts`
- Reuse: `src/server/importer/extractor.ts`
- Reuse: `src/server/memories/add-memory.ts`
- Test: `tests/server/browser-import/import-browser-capture.test.ts`
- Test: `tests/server/routes/api-browser-import.test.ts`

## Service Contract

```ts
interface ImportBrowserCaptureInput {
  payload: BrowserImportPayload;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  backupQueue: MemoryBackupQueue;
  now?: () => Date;
}
```

Behavior:

1. Select import URL:
   - Prefer `canonicalUrl` if present and valid.
   - Otherwise use `sourceUrl`.
2. Run `extractArticleWithDefuddle({ html, pageUrl: selectedUrl })`.
3. If extracted Markdown is below the readable threshold, return
   `extraction_failed` and do not create a memory.
4. Create the memory through `addMemory()` with an injected importer returning
   the extracted content.
5. Let `addMemory()` own `CONTENT.md`, SQLite row creation, cleanup on DB
   failure, and backup enqueue.

Do not write `CONTENT.md` directly from the browser-import service.

## Metadata Mapping

Use server extraction first:

```text
title: extracted.title || payload.title || hostname fallback
description: extracted.description || payload.description || null
faviconUrl: extracted.faviconUrl
markdown: extracted.markdown
```

Do not store these new fields in SQLite in this task:

- extensionVersion
- capturedAt from extension
- raw HTML
- Cloudflare challenge state

## Failure Rules

- Extraction failure returns 422 with `code: "extraction_failed"`.
- Memory is not created when browser-captured extraction fails.
- A later product task may add "create link-only anyway" as a visible option,
  but this initial assisted path should not silently create a second useless
  link-only memory.

## Verification

```bash
mise exec -- bun run test tests/server/browser-import/import-browser-capture.test.ts
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run test tests/server/memories/add-memory.test.ts
```

## Acceptance Criteria

- Valid browser-captured HTML creates a normal memory.
- `CONTENT.md` frontmatter contract is unchanged.
- Raw browser HTML is not persisted.
- Backup enqueue behavior remains owned by `addMemory()`.
- Failed extraction does not create an extra link-only memory by default.
