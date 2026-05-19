# 19.5 Reader translation UI and API

## Goal

Add translation actions to memory reader pages and expose APIs that translate the current memory into the configured target language.

## Files likely owned

- `src/components/reader/MemoryReader.tsx`
- `src/server/reader/page-data.ts`
- `src/routes/api/memories/[memoryId]/translate.ts`
- `src/routes/memories/[id].tsx`
- `src/server/translation/translate-memory.ts`
- `tests/server/routes/api-memory-translation.test.ts`
- `tests/server/reader/page-data.test.ts`
- `tests/components/memory-reader-translation.test.tsx`

## Reader UI contract

Add a translation button on the memory reader page.

Rules:

- Button uses the target language selected on `/settings`.
- If no target language is configured, show a clear settings-required state.
- If Codex auth is disabled/unusable, show a clear auth-required state.
- Clicking starts translation for the active memory.
- While translating, show pending state.
- On success, display the translated variant or navigate to the translated variant.
- Do not overwrite the source reader content.

Recommended reader state:

```text
/memories/:id?lang=ja-JP
```

If `lang` is omitted, render source `CONTENT.md`.

If `lang` is present and translation exists, render translated `CONTENT.md`.

## API contract

```http
POST /api/memories/:memoryId/translate
content-type: application/json

{
  "languageCode": "ja-JP"
}
```

Responses:

- `202` when translation starts asynchronously
- `200` when translation already exists and is current
- `201` when translation is completed synchronously
- `400` invalid language
- `401` or `409` Codex auth not enabled/usable
- `404` missing memory
- `500` unexpected translation failure

First implementation may run synchronously if the app has no job queue, but the API shape should not block later background execution.

## Translation freshness

Use `sourceContentHash`.

Rules:

- If translation exists and `sourceContentHash` matches current source, reuse it.
- If source hash changed, mark translation stale and require retranslation.
- Do not silently serve stale translation as current.

## Reader data contract

Reader page data should include:

- source memory metadata
- selected language
- available translations
- current translation status
- translated content path when `lang` is selected

## Tests

Cover:

- reader renders translation button
- button disabled/guarded when Codex auth unavailable
- button uses settings target language
- translation API creates translated content path
- translation API reuses current translation
- stale source hash requires retranslation
- `/memories/:id?lang=ja-JP` renders translated content
- source `/memories/:id` remains unchanged

## Verification

```sh
mise exec -- bun run test tests/server/routes/api-memory-translation.test.ts
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/components/memory-reader-translation.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Reader page can initiate translation.
- Translation target comes from settings.
- Translated Markdown is stored under `{memoryId}/{langCode}/CONTENT.md`.
- Source content is never overwritten.

