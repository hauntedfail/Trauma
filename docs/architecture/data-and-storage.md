# Data And Storage Architecture

Trauma separates metadata from readable content.

SQLite is the canonical runtime metadata store. Markdown files are readable
content artifacts and git-backup artifacts. The SQLite database file itself is
not backed up through Trauma's git backup feature.

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

Remote images stay remote in the initial design. Trauma is not a full offline
archive.

## SQLite Model

Initial tables:

- `memories`
- `tags`
- `categories`
- `memory_tags`
- `memory_categories`
- `highlights`

`memories` stores URL metadata, content path, extraction status, backup status,
and timestamps.

`tags` and `categories` are both many-to-many with memories. Category means a
curated grouping. Tag means ad-hoc labeling. URL import does not auto-assign
either.

## Highlight Model

Highlights are both metadata and content mutations.

`highlights` stores:

- `id`
- `memory_id`
- `text`
- `prefix`
- `suffix`
- `start_offset`
- `end_offset`
- timestamps

`highlights.memory_id` is the canonical relation. API responses may shape this
as `memory.highlights: Highlight[]`, but memories should not store a separate
highlight ID array as source-of-truth state.

Persisted highlights are inserted into `CONTENT.md` as inline marks:

```html
<mark data-highlight-id="...">selected text</mark>
```

The reader pipeline must allow `mark` and `data-highlight-id` while still
sanitizing unsafe HTML.
