# Runtime Flows

This document describes the core runtime flows that implementation should
preserve.

## Add Memory

The global add memory composer accepts only a URL.

Flow:

1. Generate a UUID v7 memory ID.
2. Fetch the URL server-side.
3. Run a Readability-style extraction pipeline.
4. Create SQLite metadata.
5. Write `{storePath}/memories/{memoryId}/CONTENT.md`.
6. Enqueue markdown backup work.

If extraction succeeds, save extracted title, body, description, favicon URL,
and markdown body.

If extraction fails or returns insufficient body content, still create a
link-only memory. Record extraction status and error details in SQLite.

Raw HTML is not stored in the initial design.

## Browser-Assisted Import

Safari, browser extension, or share-sheet assisted capture is future work.
Initial implementation should keep importer boundaries clean enough that this
path can be added later without replacing the storage model.

## Highlight

Reader content is not generally editable. Highlight creation is the only
content mutation exposed in read mode.

Flow:

1. User selects text in `/memories/:id`.
2. Frontend renders an optimistic highlight immediately.
3. Frontend sends selected `text`, `prefix`, `suffix`, `start_offset`, and
   `end_offset` to the server.
4. Server creates a `highlights` row.
5. Server inserts `<mark data-highlight-id="...">...</mark>` into `CONTENT.md`.
6. Server enqueues markdown backup work.

If persistence fails, the optimistic highlight is rolled back or surfaced as
failed.

## Git Backup

Backup is built-in git backup, not a generic hook system.

Flow:

1. Markdown write succeeds.
2. Backup work is placed on the in-process sequential queue.
3. The backup worker uses `projectPath` as the working directory.
4. The worker stages only changes under `storePath`.
5. The worker commits with the configured message template.
6. The worker pushes only when configured.
7. SQLite backup status fields are updated.

Backup failures do not roll back memory creation or highlight creation.

On startup, Trauma should find pending or failed backup states that are eligible
for retry and re-enqueue them.
