# Trauma Foundation Design

Date: 2026-05-09

## Purpose

Trauma is a personal bookmark management app. The product language uses
`memory` for one saved bookmark and `memories` for the collection. The initial
design optimizes for low maintenance, local-first operation, and a clean path to
future self-hosted deployment.

This foundation spec defines the architecture, storage model, core data flow,
UI shell, configuration, and verification expectations before implementation
planning begins.

## Scope

In scope:

- Single-user bookmark/memory management.
- URL-only add memory flow.
- Server-side URL extraction with link-only fallback.
- Markdown content store.
- SQLite metadata store.
- Category and tag filtering.
- Reader mode for saved markdown.
- User-created highlights inside reader content.
- Built-in git backup for markdown content.
- Responsive X-like shell.
- E2E-first verification.

Out of scope:

- Next.js.
- PostgreSQL or managed database services.
- Serverless or edge-first deployment.
- Authentication, authorization, user ownership, signup, or team operation.
- Generic lifecycle hooks.
- External job queues.
- Local image archival.
- Full-text search over article bodies.
- User-facing markdown editing.

## Architecture

Use a SolidStart monolith with strict internal server-side module boundaries.
The app runs as a single Bun process and uses Bun as the package manager and
runtime. The deployment target is local operation or a single VPS/home server
with persistent disk.

The app keeps UI and server-side behavior in one project, but server logic is
split into focused modules:

- `config`: load and validate `trauma.config.json`.
- `db`: Drizzle schema and repository functions over SQLite.
- `importer`: fetch URLs and extract readable content.
- `store`: create and read markdown files under the configured store path.
- `backup`: run the in-process git backup queue.
- `reader`: render markdown through the curated reader pipeline.
- `ui shell`: render the shared navigation, lists, filters, composer, and
  reader pages.

The preferred framework choice is SolidStart rather than a separate SPA plus
API server. This keeps deployment and local operation lightweight while still
allowing route loaders, server functions, SSR, and a clean module layout.

## Runtime And Dependencies

Use:

- TypeScript.
- SolidStart.
- Solid.
- Bun.
- Drizzle ORM.
- SQLite via Drizzle's Bun SQLite support.
- Playwright for end-to-end tests.

Avoid:

- Next.js.
- External queue services.
- PostgreSQL in the initial version.
- React-specific assumptions.

## Storage Model

SQLite is the canonical runtime metadata store. The SQLite database file is not
committed or backed up by Trauma's git backup feature.

Markdown files are the readable content artifacts. They live under:

```text
{storePath}/memories/{memoryId}/CONTENT.md
```

`memoryId` is UUID v7. This keeps file paths stable while preserving a
time-sortable identifier.

`CONTENT.md` contains minimal frontmatter plus markdown body. The initial
frontmatter keys are:

- `id`
- `url`
- `title`
- `captured_at`
- `extraction_status`

Tags and categories are not written to frontmatter in the initial design. SQLite
is the source of truth for those relationships.

Remote image URLs remain remote in generated markdown. Trauma is not a full
offline archive in the initial scope.

## Data Model

The initial relational model contains:

- `memories`
- `tags`
- `categories`
- `memory_tags`
- `memory_categories`
- `highlights`

`memories` stores:

- `id`
- `url`
- `title`
- `description`
- `favicon_url`
- `content_path`
- `extraction_status`
- `extraction_error`
- `backup_status`
- `last_backup_at`
- `last_backup_error`
- timestamps

`tags` and `categories` each store:

- `id`
- `name`
- timestamps

Both tags and categories are many-to-many with memories.

Category means curated grouping. Tag means ad-hoc labeling. URL import does not
auto-assign either in the initial version.

`highlights` stores:

- `id`
- `memory_id`
- `text`
- `prefix`
- `suffix`
- `start_offset`
- `end_offset`
- timestamps

`highlights.memory_id` is the canonical relation. API and loader responses may
shape this as `memory.highlights: Highlight[]`, but memories should not store a
highlight id array as a separate source of truth.

## Import Flow

The global add memory composer accepts only a URL.

On submission:

1. Generate a UUID v7 memory id.
2. Fetch the URL server-side.
3. Run a Readability-style extractor.
4. Create metadata in SQLite.
5. Write `CONTENT.md`.
6. Enqueue markdown store backup.

If extraction succeeds, save the extracted title, body, description, favicon,
and markdown body. If extraction fails or produces insufficient body content,
still create a link-only memory with extraction status and error details.

Raw HTML is not stored in the initial version. Browser-assisted capture via
Safari, extension, or share sheet is a future importer path, not part of the
first implementation.

## Highlight Flow

The reader does not expose general editing. It does allow highlight creation.
Highlight interaction is a text-range toggle, not a separate edit mode.

When the user selects text in `/memories/:id`:

1. The frontend determines whether the selected range is already fully
   highlighted.
2. If it is not already highlighted, the frontend immediately renders an
   optimistic highlight.
3. If it is already highlighted, the frontend immediately removes highlight
   styling from the selected range only.
4. The frontend sends selected `text`, `prefix`, `suffix`, `start_offset`, and
   `end_offset` to the server with the intended toggle operation.
5. The server creates, deletes, shrinks, or splits `highlights` records.
6. The server updates `CONTENT.md`.
7. The server enqueues markdown store backup.

When the user selects an already-highlighted range again, Trauma treats that as
an unhighlight toggle for the selected range only. It must not remove a larger
highlight span just because the selected text sits inside it. If the selected
range exactly matches a highlight, the server removes that highlight record and
its `<mark>`. If the selected range is a subset of a highlight, the server
shrinks or splits the remaining highlighted text into valid highlight records
and marks. If the selected range crosses multiple highlights, only the selected
overlapping text is removed from each affected highlight.

`CONTENT.md` uses inline HTML marks for persisted highlights:

```html
<mark data-highlight-id="...">selected text</mark>
```

The reader sanitizer must allow `mark` and `data-highlight-id`, while still
removing unsafe HTML and scripts.

If server persistence fails, the optimistic highlight or unhighlight state is
rolled back or marked failed in the UI.

## Backup Flow

Backup is built-in git backup, not a generic hook system.

Backup runs asynchronously through an in-process sequential queue. The queue is
triggered after markdown writes for new memories and highlights.

The git backup process:

1. Uses `projectPath` as the working directory.
2. Stages only changes under `storePath`.
3. Commits with a configured message template.
4. Pushes only when configured to do so.
5. Updates `backup_status`, `last_backup_at`, and `last_backup_error`.

`storePath` must be inside `projectPath`. This is a required startup/config
validation rule.

External queues such as Redis are out of scope. On server startup, Trauma should
look for pending or failed backup states and re-enqueue eligible work.

## Routes

Canonical routes:

- `/`
- `/memories`
- `/memories/:id`
- `/highlights`

`/` redirects to `/memories`.

`/memories` is the canonical browse and filter route. Query string state
represents filters and view options:

```text
/memories?q=...&category=...&tag=...&highlight=...&view=list|grid
```

`/category`, `/tags`, and `/memories/new` are not initial canonical routes.
Category/tag management pages are future work and require a separate spec.

`/highlights` is the canonical highlight browse route. It lists highlighted
text snippets across memories and is separate from the memory reader.

## UI Shell

The visual direction follows the current X-style layout.

Desktop layout:

- Shared left-side navigation.
- Center content area.
- Right-side category/tag/highlight panel.

The left navigation is an app shell component shared by all routes. It is not
owned by a single page.

The right panel lists categories, tags, and recent highlights. Clicking a
category or tag updates the `/memories` query filter. Clicking a highlight
shortcut applies `/memories?highlight=<highlight id>`. Source-memory navigation
belongs to the `/highlights` row title/link or reader anchors, not the primary
right-panel shortcut.

Responsive layout:

- Preserve the same conceptual shell.
- Collapse left navigation into a drawer.
- Collapse right filters into a drawer.
- Keep the add memory composer globally reachable.

Add memory is a global composer modal or drawer. It is not a separate
`/memories/new` route in the initial version.

## Reader Pipeline

The reader renders `CONTENT.md` in read mode.

The initial markdown pipeline supports:

- GitHub Flavored Markdown.
- Syntax highlighting.
- HTML sanitization.
- Footnotes.
- Heading anchors.
- Table of contents.
- Controlled external embeds.
- Highlight marks.

External embeds auto-load in the initial design. This improves reading richness
but has privacy and network side effects. Future configuration may allow lazy
or disabled embeds.

## Search And Filtering

Initial search is SQLite metadata search over fields such as title, URL,
description, categories, tags, and highlight text/context. `/memories?q=...`
must include matching memories whose highlights contain the query even when the
memory title or URL does not match.

Body full-text search and SQLite FTS are future work.

## Highlights View

`/highlights` shows highlight-centered browsing. Each row shows:

- Memory title as the source label.
- Muted prefix context before the highlighted text.
- The highlighted text.
- Muted suffix context after the highlighted text.
- A link to open the source memory at the highlight anchor.

The layout should evoke GitHub pull request file-review views: compact,
quote-oriented rows with enough surrounding context to understand where the
selection came from, without rendering the whole memory body.

## Configuration

The project root contains `trauma.config.json`.

Initial config keys:

```json
{
  "storePath": "./data/store",
  "projectPath": "./data",
  "databasePath": "./.trauma/trauma.sqlite",
  "backup": {
    "git": {
      "enabled": true,
      "remote": "origin",
      "branch": "main",
      "push": false,
      "commitMessageTemplate": "backup {action} {memoryId}"
    }
  }
}
```

The concrete default paths may be adjusted during implementation planning, but
the config model must preserve:

- Static JSON config.
- No executable config hooks.
- `storePath` inside `projectPath`.
- SQLite DB outside git backup scope.
- Built-in git backup only.

## Error Handling

Importer failures create link-only memories rather than aborting the whole
operation.

Backup failures do not roll back memory creation or highlight creation. They
are recorded in metadata and surfaced in the UI.

Highlight persistence failures roll back or flag the optimistic frontend
highlight.

Invalid config or invalid path relationships are startup errors.

Reader sanitization must reject unsafe HTML and script execution while allowing
the curated rich reader feature set.

## Testing Strategy

Verification is E2E first.

Playwright should cover:

- Add memory success path.
- Link-only fallback path.
- Markdown file creation.
- `/memories` list rendering.
- `/memories/:id` reader rendering.
- Category/tag filtering.
- Highlight selection and persistence.
- Backup status display.

Focused unit or integration tests should cover:

- Config validation.
- Drizzle repositories.
- Importer success and failure mapping.
- Markdown store writer.
- Highlight marker insertion.
- Backup queue behavior.
- Reader sanitization and rendering.

## Future Work

Future specs may cover:

- Auth and signup policy.
- Public/team operation.
- Browser-assisted import.
- Full-text body search.
- Local image archival.
- Category/tag management pages.
- Lazy or disabled embeds.
- Generic lifecycle hooks.
