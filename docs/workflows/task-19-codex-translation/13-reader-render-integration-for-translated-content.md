# 19.13 Reader render integration for translated CONTENT.md

## Goal

Render committed translated memory content without overwriting or mutating the source reader content.

## Scope

Extend reader data loading and route behavior so `memory/<memory_id>/<lang_code>/CONTENT.md` can be selected and rendered after commit.

## Inputs

- Existing memory reader route and page-data loader
- 19.2 committed translation metadata
- 19.10 atomic output writer

## Outputs

- Reader data contract with selected language, available translations, current translation status, and translated content path when selected.
- Route/query behavior for translated variants, recommended as `/memories/:id?lang=ja-JP`.
- Guard for stale or missing translations.

## Dependencies

- 19.2 for translation metadata.
- 19.10 for final file layout.
- 19.12 for UI navigation and controls.

## Acceptance criteria

- `/memories/:id` continues to render source `CONTENT.md`.
- `/memories/:id?lang=ja-JP` renders `memory/<memory_id>/ja-JP/CONTENT.md` only when a committed current translation exists.
- Missing translations show a clear not-translated state or redirect to source with a translation action.
- Stale translations are not silently served as current.
- Reader rendering uses the same safety rules expected for source Markdown.
- Source metadata remains available when viewing translated content.
- Source `CONTENT.md` is not changed by reading or rendering a translated variant.

## Parallelization notes

This can run after 19.2 and 19.10 define metadata/path contracts. Coordinate closely with 19.12 on user flow.

## Implementation risks

- Treating translated files as source memories may break frontmatter assumptions.
- Serving stale translations as current can hide source updates.
- Path traversal validation must apply to `lang_code` before resolving translated files.
