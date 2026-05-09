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

`highlight`
: User-created text selection inside reader content. Persisted in SQLite and as
`<mark data-highlight-id="...">...</mark>` inside `CONTENT.md`.

`unhighlight`
: Toggle action caused by selecting already-highlighted reader text. Only the
selected range is removed from highlight coverage; surrounding highlighted text
remains highlighted.

## Status Fields

`extraction_status`
: Import/extraction state for a memory. It distinguishes successful extraction
from partial or failed link-only creation.

`extraction_error`
: Human-readable or diagnostic extraction failure detail.

`backup_status`
: Git backup state for the memory content.

`last_backup_at`
: Timestamp of the last successful backup.

`last_backup_error`
: Diagnostic detail for the last failed backup attempt.
