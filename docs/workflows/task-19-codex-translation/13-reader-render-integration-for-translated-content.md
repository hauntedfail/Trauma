# 19.13 Reader render integration for translated CONTENT.md

## Goal

Render committed translated content variants without overwriting source reader content.

## Files likely owned

- `src/server/reader/page-data.ts`
- `src/server/translation/current-translation.ts`
- `src/components/reader/MemoryVariantTabs.tsx`
- `src/routes/memories/[id].tsx`
- `src/routes/memories/[langCode]/[id].tsx` or project-equivalent translated reader route
- `tests/server/reader/translated-page-data.test.ts`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/03-sqlite-and-repositories.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Instruction alignment

Scope: source and translated reader route loading, current-variant detection, not-found behaviour, and tab metadata.

Inputs: memory metadata, source `CONTENT.md`, translated output file, current source hash, complete translation jobs, and settings language.

Outputs: source page data, translated page data, current variant list, derived `reader_url`, and Codex trigger visibility state.

Dependencies: 19.2 provides translation repository methods; 19.10/19.11 define committed output and purge rules; 19.12 consumes page data.

Parallelization notes: can run with 19.12 only after route shape and variant metadata types are frozen.

Implementation risks: silently falling back to source on translated routes or listing stale files as current tabs breaks URL/content truthfulness.

## Route contract

```text
/memories/:id             -> source CONTENT.md
/memories/:lang_code/:id  -> translated CONTENT.md for the requested BCP 47 language when current
```

## Loader contract

1. Load memory metadata.
2. If `lang_code` route param is absent, resolve source `CONTENT.md`.
3. If `lang_code` route param is present, validate BCP 47, traversal safety, and canonical casing against the supported-language table.
4. Compute current source hash.
5. Look up complete translation for `(memory_id, lang_code, source_hash)`.
6. Use read-only `resolveCurrentTranslation()` from `src/server/translation/current-translation.ts`, not the SQLite repository alone, to verify output file existence and hash under `storePath`.
7. If output path exists and its hash matches `translation_jobs.output_hash` on the completed translation row, render translated file from store-relative `memories/<memory_id>/<lang_code>/CONTENT.md`.
8. If the complete row exists but the output file is missing or hash-mismatched, return the project-standard not-found response for the translated route without mutating SQLite. Backend API/job-start recovery owns `repairUnavailableTranslation()`.
9. If missing or stale, return the project-standard not-found response for the translated route; do not silently fall back to source content.
10. Load available variants from actual `CONTENT.md` files plus current translation metadata for tab rendering.
11. Load configured translation target language from SQLite-backed settings data for the source-route trigger.

## Rendering rules

- Source route remains unchanged.
- Translated route uses the same Markdown safety/sanitization rules as source content.
- Source metadata remains available when viewing translated content.
- Stale translations are not silently served as current.
- Unavailable translations are not silently served as current.
- Missing translations do not create jobs automatically.
- Missing or stale translated routes return the project-standard not-found response and include a link back to `/memories/:id` when the route renderer supports contextual links.
- Non-canonical language casing is not accepted as a distinct route. `ja-JP` is valid; `ja-jp` or `JA-JP` must redirect to the canonical route only if the project already has a canonical redirect helper, otherwise return the project-standard not-found response.
- Translated routes do not render the Codex translation icon.
- The source route renders a Codex icon at the right edge of the memory title only when the configured target-language variant is missing.
- The icon tooltip is `<lang_code>に翻訳する` in the Japanese UI, or `Translate to <lang_code>` if the current UI copy remains English.
- Clicking the icon starts translation through `POST /api/memories/:memory_id/translations`.

## Variant tab rules

- Variants are based on actual files under the memory store directory plus current translation metadata.
- The default source variant is store-relative `memories/<memory_id>/CONTENT.md`.
- Translated variants are store-relative `memories/<memory_id>/<lang_code>/CONTENT.md`.
- A translated variant is current only when a complete translation row exists for `(memory_id, lang_code, current_source_hash)`, the output file exists, and the file hash matches `translation_jobs.output_hash`.
- Stale translated files are not shown as normal tabs. If surfaced later, they must be disabled and labelled stale.
- If only the default source variant exists, do not render tabs.
- If two or more variants exist, render tabs immediately below the memory header.
- The source tab label is `Original`.
- Translated tab labels use language display names from the supported-language table. For example, `ja-JP` renders as `Japanese`.
- The initial supported-language table is defined in `contracts/02-types-state-and-settings.md`; route validation, settings select options, prompt display names, and tab labels must all use that same table.
- The active tab matches the current reader route.
- Source tab href is `/memories/:id`.
- Translated tab href is the derived `reader_url`, for example `/memories/<lang_code>/<memory_id>`.

## Tests

Cover:

- source route renders source `CONTENT.md`
- translated route renders committed translated `CONTENT.md`
- translated route reads store-relative `memories/<memory_id>/<lang_code>/CONTENT.md`
- stale translated output is not rendered as current
- complete row with missing or hash-mismatched output is marked unavailable and not rendered as current
- reader route and variant tab logic use the shared read-only `resolveCurrentTranslation()` helper
- reader route and variant tab rendering do not mutate SQLite when translated output is missing or hash-mismatched
- missing translated route returns not found without silently rendering source content
- stale translated route returns not found without silently rendering source content
- invalid `lang_code` is rejected
- traversal-like `lang_code` is rejected
- non-canonical `lang_code` casing is redirected to canonical only through the project-standard redirect helper, otherwise rejected as not found
- source route renders Codex icon when configured target variant is missing
- source route hides Codex icon when configured target variant exists
- translated route hides Codex icon
- tabs are hidden when only default source `CONTENT.md` exists
- tabs render when one or more translated variants exist
- stale translated files do not render as current tabs
- output files whose hash differs from `translation_jobs.output_hash` do not render or tab as current
- `ja-JP` tab label renders as `Japanese`
- tab labels for all supported language codes come from the central supported-language table
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
- Translation trigger appears only on the source route when the configured target variant is missing.
- Variant tabs reflect actual `CONTENT.md` variants.
- Variant tabs only expose current translated variants.
