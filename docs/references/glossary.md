# Glossary

## Domain Terms

`memory`
: One saved bookmark/content item.

`memories`
: The collection of saved memory items and the canonical browse route.

`CONTENT.md`
: The readable markdown file for one memory.

`storePath`
: Directory that contains memory markdown files.

`projectPath`
: Git working directory used by the built-in markdown backup feature.

`category`
: Curated grouping. A memory can have multiple categories.

`tag`
: Ad-hoc label. A memory can have multiple tags.

`Flashback`
: Product term for a user-created text marker inside reader content. This
replaces the older product term `highlight`.

`unflashback`
: Toggle action caused by selecting reader text that is already covered by a
Flashback marker. Only the selected range is removed from Flashback coverage;
surrounding marked text remains marked.

`/flashbacks`
: Canonical Flashback marker browse route. It replaces the older `/highlights`
route language and lists marked excerpts with muted prefix/suffix context and
the source memory title.

`Moment`
: Product term for a saved reader section/chapter bookmark. This replaces the
older use of `Flashback` for section bookmarks.

`/moments`
: Canonical Moment browse route. It replaces the older `/flashback` route
language for section bookmarks.

`highlight`
: Legacy implementation and historical docs term for what is now product
language `Flashback`. Do not introduce new user-facing docs or UI copy with
this term except when describing migration from the older implementation.

`bookmark`
: Generic behaviour description for what TRAUMA product language calls a
`Moment`. Prefer `Moment` in user-facing docs.

## Status Fields

`extraction_status`
: Import/extraction state for a memory. It distinguishes successful extraction
from partial or failed link-only creation. Current values are `pending`,
`success`, `link_only`, and `failed`; `src/server/memory-status.ts` is the
code source of truth.

`extraction_error`
: Human-readable or diagnostic extraction failure detail.

`backup_status`
: Git backup state for the memory content.

`last_backup_at`
: Timestamp of the last successful backup.

`last_backup_error`
: Diagnostic detail for the last failed backup attempt.
