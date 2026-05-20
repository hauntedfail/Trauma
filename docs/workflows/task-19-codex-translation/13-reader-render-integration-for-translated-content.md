# 19.13 Reader render integration for translated CONTENT.md

## Goal

Render committed translated memory content without overwriting or mutating source reader content.

## Scope

Extend reader data loading and route behavior so `memory/<memory_id>/<lang_code>/CONTENT.md` can be selected and rendered after commit.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- Existing memory reader route and page-data loader
- 19.2 committed translation metadata
- 19.10 atomic output writer

## Outputs

- Modify: `src/server/reader/page-data.ts`
- Modify: `src/routes/memories/[id].tsx`
- Test: `tests/server/reader/translated-page-data.test.ts`

## Dependencies

- 19.2 for translation metadata.
- 19.10 for final file layout.
- 19.12 for UI navigation.

## Concrete route behavior

```text
/memories/:id                -> source CONTENT.md
/memories/:id?lang=ja-JP     -> translated ja-JP CONTENT.md when current
```

Reader loader algorithm:

1. Load memory metadata.
2. If no `lang`, resolve source `CONTENT.md`.
3. If `lang` exists, validate BCP 47 and path traversal.
4. Look up complete translation for current source hash.
5. If output exists and hash matches, render translated file.
6. If missing or stale, return source metadata plus translation unavailable/stale state.

## Acceptance criteria

- Source route remains unchanged.
- Translated route renders only committed current translations.
- Stale translations are not silently served as current.
- Missing translations show a clear not-translated state or source fallback with translation action.
- Reader safety/sanitization rules apply equally to translated Markdown.
- Source metadata remains visible when viewing translation.
- Source `CONTENT.md` is never changed.

## Parallelization notes

Can run after 19.2 and 19.10 define metadata/path contracts. Coordinate with 19.12.

## Implementation risks

- Treating translated files as source memories can break frontmatter assumptions.
- Path traversal validation must happen before resolving translated files.
- Stale translation handling must not surprise the user by rendering old content as current.
