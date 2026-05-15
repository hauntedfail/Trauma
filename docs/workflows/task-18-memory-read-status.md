# Task 18: Memory actions and read status

## Status

- State: Ready for sequential implementation
- Base branch: `main`
- Implementation branch: `feat/memory-actions`
- Execution model: implement the subtasks below in order, one PR/agent slice at a time unless explicitly approved otherwise.
- Out of scope: Task 17/refine layout redesign, reader typography redesign, bulk actions, category/tag rename/delete, full taxonomy management screens, backup repository migration.

## Core intent

Task 18 adds user-owned memory metadata and memory actions:

- persistent `read: boolean`
- memory deletion
- tag/category creation
- tag/category assignment to memories
- browse rendering for link-only memories
- reusable memory action menu on browse and reader pages
- settings page for translation target language and OpenAI auth state
- explicit reader selection menu for highlight creation
- highlight records that identify the selected occurrence without mutating `CONTENT.md`
- reader-mode highlight tabs for all highlights vs current-memory highlights
- Flashback bookmarks for reader sections, with a `/flashback` route listing all saved Flashbacks
- relaxed imported media display policy for HTTPS cross-host images and controlled HTTPS iframes

The implementation must stay domain-scoped. Do not import unrelated refine-branch UI work. If the refine branch is the only place where a reusable memory meatballs menu exists, extract only that reusable component contract or recreate the equivalent shared component in this branch.

## Global invariants

- SQLite owns memory metadata, read status, tags, categories, and memory-taxonomy assignments.
- `CONTENT.md` frontmatter does not gain `read`, `tags`, or `categories`.
- New memories default to unread.
- Link-only memories render `Link-only` with an error icon.
- Successful full-content memories do not render a redundant `Saved` label.
- One memory action menu component is shared by `/memories` items and `/memories/:id` reader header.
- Deleting a memory removes the SQLite memory row and the corresponding filesystem content directory.
- Deleting a memory cascades highlights and join-table rows, but does not delete global tags/categories.
- Right-pane tags/categories list all records, not only records visible under the current browse filter.
- Reader mode renders only tags/categories attached to the active memory.
- `/settings` is part of Task 18, not a separate workflow.
- Settings APIs must validate state server-side; frontend disabled controls are not a security boundary.
- Highlight persistence is record-based. `CONTENT.md` must not be rewritten to store highlight marks.
- Highlight records identify a selected occurrence by canonical reader-text offsets plus guard context, not by selected text alone.
- `/memories` recent highlight component remains unchanged.
- Reader-mode highlight component gets tabs below its title: left tab for all highlights, second tab for the active memory's highlights.
- Flashback is the TRAUMA product name for section bookmarks.
- Flashbacks attach to reader sections/chapters, not arbitrary selected text.
- Flashback persistence is SQLite-backed metadata; it must not rewrite `CONTENT.md`.
- `/flashback` lists every Flashback with its section title and linked memory metadata.
- Imported article media may reference a different HTTPS host from the source page. Same-host-only display URL validation is too strict for real articles.
- Images may be preserved from HTTPS public hosts after stripping unsafe input.
- Iframes may be preserved only as controlled HTTPS embeds with dangerous attributes removed and reader-side sandbox/referrer controls applied.
- Do not add speculative indexes. Add indexes only when the subtask proves the query needs them.

## Subtask execution order

1. [18.1 Data model and repository foundation](task-18-memory-actions/01-data-model-and-repository-foundation.md)
2. [18.2 API and mutation service layer](task-18-memory-actions/02-api-and-mutation-service-layer.md)
3. [18.3 Shared UI primitives](task-18-memory-actions/03-shared-ui-primitives.md)
4. [18.4 Browse memory item actions](task-18-memory-actions/04-browse-memory-item-actions.md)
5. [18.5 Right-pane taxonomy management](task-18-memory-actions/05-right-pane-taxonomy-management.md)
6. [18.6 Reader memory actions](task-18-memory-actions/06-reader-memory-actions.md)
7. [18.8 Settings page and OpenAI auth state](task-18-memory-actions/08-settings-page-and-openai-auth.md)
8. [18.9 Reader highlight selection and tabs](task-18-memory-actions/09-reader-highlight-selection-and-tabs.md)
9. [18.10 Flashback section bookmarks](task-18-memory-actions/10-flashback-section-bookmarks.md)
10. [18.11 Imported media display policy](task-18-memory-actions/11-imported-media-display-policy.md)
11. [18.12 Integration verification and handoff](task-18-memory-actions/12-integration-verification-and-handoff.md)

Subtask number 18.7 is intentionally unused. The settings subtask keeps the
`18.8` label and `08-...` filename because it was defined after the reader
actions slice and before the highlight slice; do not infer a missing execution
file.

Each subtask file is written so an implementation agent can own that slice without guessing the broader intent. Later subtasks may reference earlier contracts, but should not reopen completed domain decisions unless implementation evidence proves the plan wrong.
