# Runtime Flows

This document describes the core runtime flows that implementation should
preserve.

## Add Memory

The global add memory composer accepts only a URL.

Flow:

1. Generate a UUID v7 memory ID.
2. Fetch the URL server-side.
3. Run the Defuddle-backed extraction pipeline.
4. Create SQLite metadata.
5. Write `{storePath}/memories/{memoryId}/CONTENT.md`.
6. Enqueue markdown backup work.

If extraction succeeds, save extracted title, description, favicon URL, and the
markdown body produced by Defuddle.

If extraction fails or returns empty markdown, still create a link-only memory.
Record extraction status and error details in SQLite.

Raw HTML is not stored in the initial design.

Default extraction runs behind an interruptible runtime boundary. The import
timeout budget covers fetch, validation, Defuddle parser work, and Defuddle
markdown generation; if the budget is exhausted, the importer returns link-only
fallback instead of persisting late extraction output.

## Browser-Assisted Import

Browser-assisted import exists as an optional local Chrome MV3 extension path
for pages the server cannot fetch or extract reliably.

Flow:

1. The operator enables browser import with local environment settings.
2. The user opens a page in the browser and clicks the TRAUMA extension.
3. The extension captures bounded content from the current user-visible tab.
4. The extension sends JSON to `/api/browser-import` on the local TRAUMA server
   with a bearer token.
5. The server validates enablement, token, origin, content type, payload size,
   URL shape, timestamp, and captured snapshot shape.
6. The server creates the memory through the same add-memory persistence path:
   SQLite metadata, `CONTENT.md`, and backup enqueue.
7. The extension opens the created memory route or reports the server error.

The extension is a privileged local client, not a trusted persistence layer. It
may provide browser-only access to the visible DOM, but final validation,
server-side Defuddle extraction, SQLite writes, and backup state remain
server-owned. Raw extension HTML is untrusted and must not bypass the server
sanitization and markdown-store contracts.

## Flashback

Reader content is not generally editable. Flashback creation changes SQLite
metadata and transient reader rendering; it does not rewrite `CONTENT.md`. The
same selection gesture also toggles off existing flashbacks.

Flow:

1. User selects text in `/memories/:id` or `/memories/:lang_code/:id`.
2. Frontend determines whether the selected range is already fully flashbacked.
3. If the range is not already flashbacked, the frontend renders an optimistic
   flashback immediately.
4. If the range is already flashbacked, the frontend optimistically removes
   flashback styling only from the selected range.
5. Frontend sends selected `text`, `prefix`, `suffix`, `start_offset`, and
   `end_offset` to the server with the intended toggle operation.
6. Server resolves the selection against the active reader variant text, stores
   `start_offset`, `end_offset`, and `content_hash`, then creates, deletes,
   shrinks, or splits `flashbacks` rows so SQLite represents exactly the
   flashbacked ranges that remain.
7. Server writes the active variant's `FLASHBACKS.json` as a deterministic
   metadata export for git backup.
8. Server enqueues backup work for the metadata export.

Flashback toggle rules:

- Selecting unflashbacked text creates a flashback for the selected range.
- Selecting an already-flashbacked range unflashbacks the selected range only.
- Selecting a subset of a larger flashback preserves the unselected flashbacked
  text by shrinking or splitting metadata.
- Selecting across multiple existing flashbacks removes only the selected
  overlap from each affected flashback.

Selection payload:

1. `text`
2. `prefix`
3. `suffix`
4. `start_offset`
5. `end_offset`

The server stores offsets in active-variant reader text and guards them with
`content_hash` in `sha256:<hex>` format. Hash-mismatched flashbacks are treated
as stale and are not rendered at a guessed location.

Translated reader variants include `langCode` in Flashback toggle requests.
The server validates the current translation, reads translated `CONTENT.md`,
and uses translated reader offsets with a variant scope of `(memory_id,
lang_code, translation_output_hash)`. It does not write translated Flashback
changes into source rows. If the translated output is missing, stale, or
hash-mismatched, the Flashback toggle fails closed instead of guessing
translated text.

Moment creation on translated reader variants also includes `langCode`. The
server validates the posted section against translated ToC data, then stores
the source ToC section with the same `sectionPath` and level. Moment rows remain
source canonical.

If persistence fails, the optimistic UI state is rolled back or surfaced as
failed.

If flashback persistence returns backup failsafe metadata, the frontend must
refresh the global backup failsafe alert before showing the local flashback
failure state.

## Psychiatrist

Psychiatrist is a reader-only, memory-scoped assistant. It appears on source and
translated reader routes and talks to TRAUMA API routes only; browser code never
connects to Codex app-server directly.

Flow:

1. The reader creates or resumes a thread for the active memory variant through
   `/api/memories/:memoryId/psychiatrist/threads`.
2. The server loads the active source or translated memory context, records the
   active content hash, and stores thread metadata under
   `{storePath}/memories/{memoryId}/threads/{threadId}/`.
3. A user prompt creates one pending pair in `PAIRS.jsonl` before Codex
   execution starts. Prompts and answers are pair records under the thread
   subtree, not SQLite rows.
4. The server builds the deterministic Psychiatrist prompt from the repo-local
   `psychiatrist` policy, active memory context, visible pair history, and
   current user prompt.
5. Codex app-server turns run backend-only with shell access, file editing,
   local filesystem browsing, project/store roots, and network access denied by
   default. Network may be enabled only for a user-approved web-source turn.
6. Safe process and answer events are written to
   `streams/{turnId}.jsonl` before SSE fan-out, so navigation and reload can
   replay already-visible output.
7. A completed first answer writes `pairs/{pairId}/RESPONSE.md`, rewrites
   `THREAD.md`, appends a completed pair revision, and enqueues built-in git
   backup with reason `psychiatrist_thread_update`.
8. Regenerate reuses the same stored prompt and context provenance for the same
   pair, overwrites the existing `RESPONSE.md`, rewrites `THREAD.md`, and
   enqueues backup with reason `psychiatrist_response_regenerate`.

Every durable assistant answer belongs to exactly one stored user prompt in the
same pair. Failed, canceled, stale, and permission-required turns must not append
orphan assistant responses. Psychiatrist writes are limited to the memory-local
`threads/` subtree; canonical `CONTENT.md`, translated `CONTENT.md`, taxonomy,
Flashbacks, Moments, settings, and other SQLite state are not modified by chat.

## Git Backup

Backup is built-in git backup, not a generic hook system.

Flow:

1. Markdown write succeeds.
2. Backup work is placed on the in-process sequential queue.
3. The backup worker uses `projectPath` as the working directory.
4. The worker stages only changes under `storePath`.
5. The worker commits with the configured message template, including the
   backup action when `{action}` is present.
6. The worker pushes only when configured.
7. SQLite backup status fields are updated.

Backup failures do not roll back memory creation or flashback creation.

On startup, TRAUMA should find pending, queued, or failed backup states that are
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
remote/branch changes while successful backup rows already exist, TRAUMA must
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
