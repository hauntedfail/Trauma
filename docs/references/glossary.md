# Glossary

## Domain Terms

`memory`
: One saved bookmark/content item.

`memories`
: The collection of saved memory items and the canonical browse route.

`CONTENT.md`
: The readable markdown file for one memory.

`storePath`
: Directory that contains source/translated reader files, portable metadata
exports, and memory-local Psychiatrist thread artifacts.

`projectPath`
: Git working directory used by built-in backup for explicitly enqueued
`storePath` artifacts.

`category`
: Curated grouping. A memory can have multiple categories.

`tag`
: Ad-hoc label. A memory can have multiple tags.

`Flashback`
: Product term for a user-created text marker inside reader content.

`unflashback`
: Toggle action caused by selecting reader text that is already covered by a
Flashback marker. Only the selected range is removed from Flashback coverage;
surrounding marked text remains marked.

`/flashbacks`
: Canonical Flashback marker browse route. It lists marked excerpts with muted
prefix/suffix context and the source memory title.

`Moment`
: Product term for a saved reader section/chapter bookmark. This replaces the
older use of `Flashback` for section bookmarks.

`/moments`
: Canonical Moment browse route for section bookmarks.

`bookmark`
: Generic behaviour description for what TRAUMA product language calls a
`Moment`. Prefer `Moment` in user-facing docs.

`Psychiatrist`
: TRAUMA product language for a memory-scoped reader assistant. It answers from
the active memory context and current thread pair history; it is not a medical
professional and does not provide diagnosis or treatment advice.

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
