# Runtime Flows

These are the durable runtime boundaries implementation must preserve. Storage
ownership is defined in [Data and storage](data-and-storage.md).

## Add Memory

The global composer accepts one URL.

1. Validate that the configured backup environment is ready for a new write.
2. Generate a UUID v7 memory ID and capture the current timestamp.
3. Fetch and validate the public URL, then run Defuddle extraction inside the
   interruptible import timeout boundary.
4. Use extracted Markdown on success or a safe Markdown link on link-only
   fallback. Raw HTML is never persisted.
5. Write `{storePath}/memories/{memoryId}/CONTENT.md` with `overwrite: false`.
6. Insert the SQLite `memories` row with the new content path and initial backup
   status.
7. If the SQLite insert fails, delete the newly written memory directory before
   returning the error.
8. If backup is enabled, enqueue the written content path and persist the best
   available backup status.

Extraction failure or empty output still creates a link-only memory and records
the extraction detail. Import timeout covers fetch, host/redirect validation,
Defuddle parsing, and Markdown generation; late extraction output is discarded.

Once both `CONTENT.md` and the memory row are durable, backup enqueue or backup
status-update failure must not turn the successful create into an ambiguous
failed request. Return the created memory with the best persisted status.

## Browser-Assisted Import

The optional local Chrome MV3 extension handles pages the server cannot fetch
or extract reliably.

1. The operator enables browser import and configures its bearer token.
2. The extension captures a bounded snapshot from the current user-visible tab.
3. It POSTs JSON to `/api/browser-import` on the local TRAUMA server.
4. The server validates enablement, token, extension origin, content type,
   payload size, URL, timestamp, and captured snapshot shape.
5. Server-side Defuddle extraction and the normal add-memory persistence flow
   create the memory.
6. The extension opens the created reader or reports the server error.

Extension HTML is untrusted input. The extension never writes the store or
SQLite directly and cannot bypass server sanitization, URL policy, or backup
readiness.

## Flashback Toggle

Reader content is not generally editable. A selection toggles variant-local
Flashback ranges without rewriting `CONTENT.md`.

1. The user selects text on a source or translated reader.
2. The frontend optimistically adds or removes styling only for the selected
   range.
3. It sends text, prefix, suffix, start/end offsets, intended operation, and the
   active language when translated.
4. The server resolves the selection against current active-variant reader text
   and fails closed if the content or translation hash is stale.
5. It creates, deletes, shrinks, or splits SQLite rows so only the intended
   ranges change.
6. It rewrites the active variant's deterministic `FLASHBACKS.json` export.
7. It enqueues that export for backup.

Offsets use canonical reader text and a `sha256:<hex>` content hash. Translated
rows are additionally scoped by language and translation output hash. A stale
row is not rendered at a guessed location. Persistence failure rolls back or
clearly fails the optimistic UI; backup failsafe metadata also refreshes the
global alert.

## Moment Toggle

Moments bookmark source-canonical reader sections.

1. The reader submits the selected table-of-contents section.
2. On a translated route, the server validates the translated section and maps
   it to the source section with the same path and level.
3. The server creates or removes the corresponding SQLite `moments` row.
4. Reader and `/moments` projections are revalidated.

Moment persistence does not mutate reader Markdown. The current contract has no
Moment store export; see the ownership matrix before changing backup behavior.

## Brilliant Translation

Translation runs through the separately operated Codex app-server and uses
durable SQLite job/chunk state.

1. `POST /api/memories/:memoryId/translations` validates the request, resolves
   the configured target language and Codex model/effort, loads source
   `CONTENT.md`, and hashes it.
2. If a completed translation and file are current, the route returns
   `status: current`. If the same source/language already has active work, it
   returns `status: active` and reschedules that job when recoverable.
3. Otherwise it parses the source into translatable blocks, creates one pending
   job plus its chunk records, emits queued events, and schedules the job on the
   in-process sequential runner.
4. The runner claims `pending` work or resumes `running`, `stitching`, or
   `committing` work. It re-reads the source and marks the job stale when the
   source hash changed.
5. Each chunk is sent through the Brilliant prompt/validation boundary and its
   validated Markdown and projection data are persisted before the next chunk.
6. Cancellation is checked before and after chunk work. Pending jobs cancel
   immediately; running jobs move to `cancel_requested` and interrupt the active
   Codex turn. Stitching, committing, and terminal jobs reject cancellation to
   avoid ambiguous final state.
7. The runner transitions through `running -> stitching -> committing` with
   compare-and-set guards, then rechecks the source hash.
8. Completed chunks are stitched in order and the final Markdown/frontmatter
   structure is validated.
9. The translated `CONTENT.md` is file-synced and atomically renamed into its
   language directory. TRAUMA hashes the written bytes, writes
   `TRANSLATION_MAP.json`, replaces SQLite projection spans, and marks the job
   complete with output path/hash.
10. Completed chunk payloads are purged best-effort. Translation content and
    projection export are enqueued for backup; enqueue failure does not undo a
    completed translation.

The SSE endpoint first sends the durable job snapshot, then any in-process
replay events, follows live events, sends heartbeats, and closes on a terminal
state. Reconnecting after a process restart relies on the durable snapshot, not
on replay history that lived only in the previous process.

## Psychiatrist

Psychiatrist is a reader-only, memory-scoped assistant. Browser code talks only
to TRAUMA API routes; it never connects directly to Codex app-server.

1. A source or translated reader creates or resumes a thread for the active
   memory variant.
2. The server loads current memory context and stores thread metadata under
   `{storePath}/memories/{memoryId}/threads/{threadId}/`.
3. A user message writes the pending pair revision, `PROMPT.md`, context
   snapshot, turn record, and stream path before Codex execution begins.
4. The deterministic prompt combines the repo-local Psychiatrist policy, active
   memory context, visible pair history, and current user prompt.
5. Codex turns run backend-only from an ephemeral empty working directory with
   `approvalPolicy: never` and a read-only sandbox. Prompt policy forbids shell
   and filesystem use; the required external process/container boundary makes
   the home directory, application project, and memory store unreadable. Network
   is disabled unless the user approved public web sources for that turn.
6. Safe process and answer events are appended to the turn stream before SSE
   fan-out, so navigation and reload can replay visible output.
7. A completed first answer writes `RESPONSE.md`, updates pair/thread/turn state,
   refreshes `THREAD.md`, and enqueues all completed artifacts for backup.
8. Regenerate reuses the stored prompt/context provenance for the same pair,
   replaces that pair's response, refreshes the transcript, and enqueues the
   updated artifacts.

Every durable answer belongs to one stored user prompt in the same pair. Failed,
canceled, stale, and permission-required turns cannot append orphan assistant
responses. Closing the panel or navigating away disconnects browser SSE only;
Stop is the explicit cancellation action.

Psychiatrist writes are limited to the memory-local `threads/` subtree. Source
and translated content, taxonomy, Flashbacks, Moments, settings, and SQLite
domain state remain unchanged.

## Git Backup

Backup is built-in git backup, not a generic hook system.

1. The owning domain persists its durable store artifact or backup intent.
2. Explicit relative paths enter the in-process sequential queue.
3. The worker uses `projectPath` as the git working directory and stages only
   those paths after confirming they remain under `storePath`.
4. It commits with the configured template and pushes only when configured.
5. SQLite backup status and failsafe state are updated where the domain owns
   such state.

Backup failure does not roll back an already durable memory, Flashback export,
translation, or Psychiatrist answer. Startup retries eligible pending, queued,
or failed work; process-local `queued` state from a prior process is eligible.

Backup readiness is tied to the full persisted identity: project/store paths,
remote name and URL, branch, and already-successful tracked content. A recreated
repository or changed identity requires explicit recovery rather than silent
acceptance.

Recovery is retry-safe. Existing migration targets are accepted only when their
bytes match the source. A push failure after local migration preserves the local
commit and remains retryable after remote repair.

Missing, out-of-scope, or untracked content recorded as successfully backed up
is a content-integrity failure, not path drift. Only a rechecked `missing_file`
case may offer deletion of the orphan SQLite memory row; other cases require
repository/path repair without discarding content.
