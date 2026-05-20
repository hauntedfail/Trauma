# 19.13 Reader render integration for translated CONTENT.md

## Goal

Render committed translated content variants without overwriting source reader content.

## Files likely owned

- `src/server/reader/page-data.ts`
- `src/routes/memories/[id].tsx`
- `tests/server/reader/translated-page-data.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/03-sqlite-and-repositories.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Route contract

```text
/memories/:id             -> source CONTENT.md
/memories/:id?lang=ja-JP  -> translated ja-JP CONTENT.md when current
```

## Loader contract

1. Load memory metadata.
2. If `lang` is absent, resolve source `CONTENT.md`.
3. If `lang` is present, validate BCP 47 and traversal safety.
4. Compute current source hash.
5. Look up complete translation for `(memory_id, lang, source_hash)`.
6. If output path exists and hash matches, render translated file.
7. If missing or stale, return source metadata plus translation unavailable/stale state.

## Rendering rules

- Source route remains unchanged.
- Translated route uses the same Markdown safety/sanitization rules as source content.
- Source metadata remains available when viewing translated content.
- Stale translations are not silently served as current.
- Missing translations do not create jobs automatically.

## Tests

Cover:

- source route renders source `CONTENT.md`
- translated route renders committed translated `CONTENT.md`
- stale translated output is not rendered as current
- missing translated output returns unavailable state
- invalid `lang` is rejected
- traversal-like `lang` is rejected
- source metadata remains present
- source file is not mutated

## Verification

```sh
mise exec -- bun run test tests/server/reader/translated-page-data.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Reader supports translated variants.
- Source and translated content paths remain distinct.
- Stale content is visible as stale/unavailable, not silently current.
