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

Default extraction runs behind an interruptible runtime boundary. The import
timeout budget covers fetch, validation, parser work, and markdown conversion;
if the budget is exhausted, the importer returns link-only fallback instead of
persisting late extraction output.

## Browser-Assisted Import

Safari, browser extension, or share-sheet assisted capture is future work.
Initial implementation should keep importer boundaries clean enough that this
path can be added later without replacing the storage model.

## Highlight

Reader content is not generally editable. Highlight creation is the only
content mutation exposed in read mode. The same selection gesture also toggles
off existing highlights.

Flow:

1. User selects text in `/memories/:id`.
2. Frontend determines whether the selected range is already fully highlighted.
3. If the range is not already highlighted, the frontend renders an optimistic
   highlight immediately.
4. If the range is already highlighted, the frontend optimistically removes
   highlight styling only from the selected range.
5. Frontend sends selected `text`, `prefix`, `suffix`, `start_offset`, and
   `end_offset` to the server with the intended toggle operation.
6. Server creates, deletes, shrinks, or splits `highlights` rows so SQLite
   represents exactly the highlighted ranges that remain.
7. Server inserts or removes `<mark data-highlight-id="...">...</mark>` ranges
   in `CONTENT.md` to match SQLite.
8. Server enqueues markdown backup work.

Highlight toggle rules:

- Selecting unhighlighted text creates a highlight for the selected range.
- Selecting an already-highlighted range unhighlights the selected range only.
- Selecting a subset of a larger highlight preserves the unselected highlighted
  text by shrinking or splitting marks and metadata.
- Selecting across multiple existing highlights removes only the selected
  overlap from each affected highlight.

Selection payload:

1. `text`
2. `prefix`
3. `suffix`
4. `start_offset`
5. `end_offset`

If persistence fails, the optimistic UI state is rolled back or surfaced as
failed.

If highlight persistence returns backup failsafe metadata, the frontend must
refresh the global backup failsafe alert before showing the local highlight
failure state.

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

On startup, Trauma should find pending, queued, or failed backup states that are
eligible for retry and re-enqueue them. `queued` is process-local, so queued rows
from a previous process are eligible after restart.

Backup failsafe recovery actions must be retry-safe. If migration already
copied a file before a later git step failed, rerunning migration may accept the
existing target only when its bytes match the source. Different target content
remains a hard conflict.

Backup readiness is tied to the full backup identity, not just filesystem
paths. The persisted stamp must match project path, store path, git remote,
remote URL, branch, and already-successful tracked content before new writes are
accepted. If the repository is recreated at the same path, or the configured
remote/branch changes while successful backup rows already exist, Trauma must
force an explicit recovery path instead of silently treating the new repository
as complete.

When already-successful backup rows point at missing, out-of-scope, or
untracked content, the alert is a content-integrity failure rather than a path
drift. The UI and logs must not describe this as a backup location change or
offer path migration as a remedy.

Only `missing_file` content-integrity alerts may offer deletion of the orphan
SQLite memory record. If the content still exists but is untracked or outside
the configured paths, recovery must preserve the record and require backup
repository/path repair instead.

If migration commits local backup content but the configured push fails, the
operator must be able to retry that recovered push after repairing the remote.
A push-failure alert must not turn a completed local migration into an
unrecoverable banner state.
