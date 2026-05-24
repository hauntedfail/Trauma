# Data And Storage Architecture

TRAUMA separates metadata from readable content.

SQLite is the canonical runtime metadata store. Markdown files are readable
content artifacts and git-backup artifacts. The SQLite database file itself is
not backed up through TRAUMA's git backup feature.

## Memory Content Store

Memory content lives under:

```text
{storePath}/memories/{memoryId}/CONTENT.md
```

`memoryId` is UUID v7. The ID is stable and not derived from title, URL, tags,
or category names.

`CONTENT.md` contains minimal frontmatter plus markdown body. Initial
frontmatter keys:

- `id`
- `url`
- `title`
- `captured_at`
- `extraction_status`

Tags and categories are not written to frontmatter. SQLite is their source of
truth.

`extraction_status` values are defined by `src/server/memory-status.ts`. The
markdown frontmatter parser, writer, SQLite schema constraint, and tests must
derive from that shared contract or include explicit drift coverage.

Remote images stay remote in the initial design. TRAUMA is not a full offline
archive.

## SQLite Model

Runtime tables:

- `memories`
- `tags`
- `categories`
- `memory_tags`
- `memory_categories`
- `flashbacks`
- `translation_jobs`
- `translation_chunks`
- `translation_projection_spans`
- `backup_environment_stamps`
- `backup_failsafe_alerts`

`memories` stores URL metadata, content path, extraction status, backup status,
and timestamps.

Runtime initialization applies bundled migrations before repositories are
returned. Application code must not observe a partially initialized SQLite
schema.

`tags` and `categories` are both many-to-many with memories. Category means a
curated grouping. Tag means ad-hoc labeling. URL import does not auto-assign
either.

`backup_environment_stamps` stores the validated backup identity for the local
markdown backup repository: resolved paths, configured remote, remote URL when
available, branch, and timestamps. Startup and backup writes compare the current
config against this stamp before accepting new writes.

`backup_failsafe_alerts` stores the single active critical backup alert, when
one exists. Alert kinds distinguish path drift, missing backup repository,
remote push failure, and backup content inconsistency so the UI can offer only
the recovery actions that are safe for that condition.

## Flashback Model

Flashbacks are SQLite metadata rendered into reader HTML at read time.

`flashbacks` stores:

- `id`
- `memory_id`
- `text`
- `prefix`
- `suffix`
- `start_offset`
- `end_offset`
- `content_hash`
- timestamps

`flashbacks.memory_id` is the canonical relation. API responses may shape this
as `memory.flashbacks: Flashback[]`, but memories should not store a separate
flashback ID array as source-of-truth state.

New flashback rows use canonical reader-text offsets. `content_hash` uses the
`sha256:<hex>` format and hashes the same canonical reader text used for offset
calculation after line endings are normalized to `\n`. If the current reader
text hash does not match the row, the reader must not render that flashback at a
guessed location.

Flashback browse and search views use `text`, `prefix`, `suffix`, and the
related memory title. The flashback table remains the canonical source for
flashback snippets; no separate denormalized flashback feed is introduced in
the initial design.

`CONTENT.md` is not mutated for normal flashback persistence. The reader applies
records as transient inline marks when rendering:

```html
<mark data-flashback-id="...">selected text</mark>
```

The reader pipeline must allow `mark` and `data-flashback-id` while still
sanitizing unsafe HTML.

Flashback removal uses the same text-range model as flashback creation. When a
user selects text that is already flashbacked, only the selected range is
unflashbacked. Exact matches delete the corresponding `flashbacks` row and
remove the rendered mark. Partial matches shrink the existing range or split it
into multiple remaining flashback ranges in SQLite. This prevents a nested or
wider flashback from being removed when the user intended to toggle off only a
sentence or phrase.

Because the built-in git backup does not back up SQLite directly, flashback
changes write a deterministic metadata export at:

```text
{storePath}/memories/{memoryId}/FLASHBACKS.json
```

That file is a backup/export artifact, not the runtime source of truth.

## Translation Projection Storage

Translated content is stored beside the source memory:

```text
{storePath}/memories/{memoryId}/{langCode}/CONTENT.md
{storePath}/memories/{memoryId}/{langCode}/TRANSLATION_MAP.json
```

`translation_jobs` is the current/history table for translation attempts.
`translation_chunks` may temporarily hold translated chunk Markdown while a job
is running, but completed chunk bodies and temporary projection JSON are purged
after final commit.

`translation_projection_spans` stores durable runtime alignment from source
reader offsets to translated reader offsets. Rows are keyed by `memory_id`,
`lang_code`, `source_hash`, and `output_hash`, so translated annotations are
used only when both the source file and translated file still match the
completed translation. `TRANSLATION_MAP.json` is the git-backup/export artifact
for the same projection data; SQLite remains the runtime source of truth.

`flashbacks` and `moments` remain source canonical. TRAUMA does not create
language-specific annotation rows. Translated reader routes project canonical
annotations at read time, and translated writes reverse-project back to source
metadata only when the projection spans align exactly.
