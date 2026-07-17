# Runtime Flows

These are the durable runtime boundaries implementation must preserve. Storage
ownership is defined in [Data and storage](data-and-storage.md).

## Add Memory

The global composer accepts one URL.

The shell owns one submission controller shared by the rail and phone popovers.
It assigns a cryptographically random UUID v7 identity to each normalized URL
attempt. Closing a popover does not abandon the pending request; retrying a
failed or response-lost attempt reuses its identity, while changing the URL
rotates it.

1. Validate the optional `Idempotency-Key` header as a canonical UUID v7 before
   configuration, database, or store work. Requests without the header remain
   supported and receive a server-generated UUID v7 memory ID.
2. Validate the public URL, then durably reserve an idempotency key for that
   preflight-normalized request URL. Reusing a key for a different URL fails
   with `409`; URL equality alone never deduplicates memories.
3. Coalesce concurrent work for the same key and URL. A retry returns its
   existing or creation-journal-recovered row before importing again. An old
   reservation whose row and recoverable creation journal are both absent
   returns a stable `409` without importing; this includes replays after later
   deletion. A clean initial failure before recoverable state releases only the
   newly inserted reservation so the same failed attempt can retry.
4. Validate that the configured backup environment is ready for a new write.
5. Acquire one of four process-wide URL-import slots without queueing. If all
   slots are occupied, return `429 import_busy` with `Retry-After: 1` before
   fetch or extraction begins; every terminal path releases its slot.
6. Fetch the public URL, then run Defuddle extraction inside the
   interruptible import timeout boundary.
7. Use extracted Markdown on success or a safe Markdown link on link-only
   fallback. Raw HTML is never persisted.
8. Persist a creation journal containing the intended SQLite row.
9. Durably publish `{storePath}/memories/{memoryId}/CONTENT.md` with
   `overwrite: false`: write a same-directory temporary file, sync its bytes,
   publish it without replacing an existing file, and sync the owning directory
   hierarchy before SQLite success is possible.
10. Insert the SQLite `memories` row with the new content path and initial backup
   status.
11. Remove the creation journal. If the SQLite insert fails, delete the newly
   written memory directory before returning the error.
12. If backup is enabled, enqueue the written content path and persist the best
   available backup status.

Extraction failure or empty output still creates a link-only memory and records
the extraction detail. Import timeout covers fetch, host/redirect validation,
Defuddle parsing, and Markdown generation; late extraction output is discarded.

Once both `CONTENT.md` and the memory row are durable, backup enqueue or backup
status-update failure must not turn the successful create into an ambiguous
failed request. Return the created memory with the best persisted status.
On startup, a surviving creation journal reconstructs a missing SQLite row only
when its owning `CONTENT.md` exists; otherwise the unused journal is removed. A
surviving journal with an existing row but missing canonical content is an
integrity failure and remains available for diagnosis rather than being cleared.

## Delete Memory

Deletion accepts only the canonical
`memories/{memoryId}/CONTENT.md` path owned by the requested row.

Before inspecting or moving artifacts, deletion reserves the memory against
process-local artifact publication. It waits for an already-admitted short
publication to finish and rejects new translation, Flashback, and Psychiatrist
writes until deletion either completes or restores the memory after failure.

1. Back up the current memory artifacts locally when git backup is enabled.
2. Persist a deletion journal, then atomically move the owning memory directory
   into delete staging.
3. Commit the staged deletion before removing the SQLite row.
4. Remove staged content and the journal after the row is gone.

Startup recovery restores staged content and marks backup pending while the row
still exists. If both canonical and staged content are already absent, recovery
marks the row pending, revalidates the full backup environment, commits the
deletion, and only then removes the row and journal. Any backup or validation
failure keeps the pending row and journal for retry. If the row is already gone,
recovery finishes staging cleanup.

Operation-journal recovery is exclusive per resolved `storePath`: it waits for
active journaled mutations, and a queued recovery prevents a new journaled
mutation from starting. Add and delete acquire a shared lease before writing a
journal and retain it through terminal journal removal or rollback. Different
mutations may still run concurrently; the barrier exists only to prevent
recovery from consuming or restoring an operation that is still active.

## Browser-Assisted Import

The optional local Chrome MV3 extension handles pages the server cannot fetch
or extract reliably.

1. The operator enables browser import and configures a cryptographically random
   bearer token that satisfies the configuration contract.
2. The extension captures a bounded snapshot from the current user-visible tab.
3. It POSTs JSON to `/api/browser-import` on the local TRAUMA server.
4. The server validates enablement, token, extension origin, content type,
   payload size, URL, timestamp, and captured snapshot shape.
5. Before reading the request body, the route acquires one of two process-wide
   browser-import slots without queueing. Overflow returns
   `429 browser_import_busy` with `Retry-After: 1`; every response and failure
   releases its slot.
6. Server-side Defuddle extraction and the normal add-memory persistence flow
   create the memory.
7. The extension opens the created reader or reports the server error.

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
5. It persists backup intent before creating, deleting, shrinking, or splitting
   SQLite rows so only the intended ranges change.
6. It rewrites the active variant's deterministic `FLASHBACKS.json` export.
7. It enqueues that export for backup.

Offsets use canonical reader text and a `sha256:<hex>` content hash. Translated
rows are additionally scoped by language and translation output hash. A stale
row is not rendered at a guessed location. Failure before authoritative SQLite
and export publication rolls back or clearly fails the optimistic UI. Once
both are durable, backup enqueue or status failure keeps the toggle successful,
returns an explicit backup warning with `pending` or `failed` status, and does
not restore the old rows or export. Backup failsafe metadata also refreshes the
global alert. Startup retry regenerates a missing or stale export from its
authoritative SQLite rows before backup.

## Moment Toggle

Moments bookmark source-canonical reader sections.

1. The reader submits the selected table-of-contents section.
2. On a translated route, the server validates the translated section and maps
   it to the source section with the same path and level.
3. The server creates or removes the corresponding SQLite `moments` row.
4. Reader and `/moments` projections are revalidated.

Moment persistence does not mutate reader Markdown. The current contract has no
Moment store export; see the ownership matrix before changing backup behavior.

## Collection Browse Pagination

Flashback and Moment interactive reads use bounded keyset pages.

1. The client submits no cursor for the first page or returns the opaque cursor
   from the preceding page.
2. The server validates the version, collection kind, timestamp, ID, and limit
   before opening collection storage.
3. The repository applies `(created_at, id)` descending keyset predicates and a
   SQL limit. It never loads the full collection for a paged request.
4. Flashbacks validate only bounded raw batches and advance past stale rows;
   Moments resolve targets only for the current raw page.
5. `/flashbacks`, `/moments`, and Reader All replace their current page rather
   than accumulating rows.

No-query `GET /api/moments` retains its full-list envelope. The Flashback
mutation route remains POST-only. Paged clients explicitly use `page=1` on the
Moments API or the separate `/api/flashbacks/page` route; mutation behavior is
unchanged.

## Brilliant Translation

Translation runs through the separately operated Codex app-server and uses
durable SQLite job/chunk state. Before new or recoverable Codex work is reserved,
the shared runtime-isolation assertion must confirm that an external boundary
makes host data unreadable to the app-server.

Before the Reader starts a translation, it sends the selected language, model,
and reasoning effort together to `PATCH /api/settings/translation-defaults`.
The route applies the normal mutation Host/origin/body guards, validates every
field and the Codex catalog selection, then persists all three defaults with one
settings update. The Reader uses the canonical language/model/effort returned in
`SettingsState` for the translation `POST`; it must not reuse stale form values.
The language-mismatch rejection in the runner remains a required defense for
direct or stale callers. Existing language-only and Codex-only settings routes
remain compatible for their current clients.

1. `POST /api/memories/:memoryId/translations` validates the request, resolves
   the configured target language and Codex model/effort, loads source
   `CONTENT.md`, and hashes it.
2. If a completed translation and file are current, the route returns
   `status: current`. If the same source/language already has active work, it
   returns `status: active` and reschedules that job when recoverable.
3. Otherwise it parses the source into translatable blocks, creates one pending
   job plus its chunk records, emits queued events, closes the short-lived
   probe/model-selection Codex client, and schedules only durable job identity
   and runtime dependencies on the in-process sequential runner. The runner
   opens a fresh Codex client only when that job reaches execution.
4. The runner claims `pending` work or resumes `running`, `stitching`, or
   `committing` work. It re-reads the source and marks the job stale when the
   source hash changed. Before reusing any chunk, it requires the persisted
   prompt-policy and chunker versions, chunk count, chunk indexes, source chunk
   hashes, and ordered block IDs to match the current runtime manifest exactly.
   An incompatible job fails terminally and permits a fresh attempt; it cannot
   write output or enter backup.
5. Each chunk is sent through the Brilliant prompt/validation boundary and its
   validated Markdown and projection data are persisted before the next chunk.
   Translated text is admitted by UTF-8 bytes before projection or payload
   persistence: at most 1 MiB per segment and 4 MiB across one chunk. Overflow
   is a terminal, non-auto-retried `validation_failed` attempt.
   Codex events pass fixed serialized UTF-8 admission before any delta reaches
   replay or SSE. The 4,096-event/4-MiB chunk-attempt budget resets for each
   attempt; the 262,144-event/32-MiB job budget accumulates across every chunk
   and retry. A 64-KiB event or any cumulative overflow stops callbacks,
   interrupts the active turn best-effort, and fails without retry through the
   existing safe unknown error contract.
6. Cancellation is checked before and after chunk work. Pending jobs cancel
   immediately; running jobs move to `cancel_requested` and interrupt the active
   Codex turn. Stitching, committing, and terminal jobs reject cancellation to
   avoid ambiguous final state.
7. The runner transitions through `running -> stitching -> committing` with
   compare-and-set guards, then rechecks the source hash.
8. Completed chunks are stitched in order and the final Markdown/frontmatter
   structure is validated.
9. Backup intent for `CONTENT.md` and `TRANSLATION_MAP.json` is persisted before
   either terminal artifact is written.
10. The terminal artifact/SQLite publication holds the memory mutation
    reservation and rechecks it immediately before each write. The translated
    `CONTENT.md` is file-synced and atomically renamed into its
   language directory. TRAUMA hashes the written bytes, writes
   `TRANSLATION_MAP.json`, replaces SQLite projection spans, and marks the job
   complete with output path/hash.
11. Completed chunk payloads are purged best-effort. Translation content and
    projection export are enqueued for backup; enqueue failure does not undo a
    completed translation.

A crash after the atomic output rename but before projection or SQLite
completion leaves the durable job in `committing` with its chunks intact. The
next start for the same source and language reschedules that job; replay rewrites
the output and projection, completes SQLite state, and repeats backup intent and
enqueue.

In-process replay retains at most 500 events and 4 MiB, evicting the oldest
events by both limits while preserving order. The SSE endpoint pulls the durable
job snapshot and replay one event at a time, then follows live events through a
per-subscriber queue capped at 128 events and 3 MiB. Heartbeats are sent only
when the stream has desired capacity. A slow subscriber overflow unsubscribes
and errors only that connection; reconnect reads the bounded replay. Terminal
events or refreshed terminal snapshots are sent before exact cleanup and close.
Reconnecting after a process restart still relies on the durable snapshot, not
on replay history that lived only in the previous process.

Codex device-login polling owns an `AbortController` per polling generation and
passes its signal into each in-flight auth-status `GET`. Canceling setup or
unmounting Settings aborts both delay and fetch work. An `AbortError` is normal
cancellation: it must not publish failure feedback or a stale auth state, and an
older poll completion must not clear or re-enable controls owned by a newer
action generation.

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
6. Safe process and answer events enter a bounded serialized persistence queue.
   Each accepted event is appended and file-synced in the turn stream before
   SSE fan-out, so navigation and reload can replay only durable visible output.
7. A completed first answer writes `RESPONSE.md`, updates pair/thread/turn state,
   refreshes `THREAD.md`, and enqueues all completed artifacts for backup.
8. Regenerate reuses the stored prompt/context provenance for the same pair,
   replaces that pair's response, refreshes the transcript, and enqueues the
   updated artifacts.

Every durable answer belongs to one stored user prompt in the same pair. Failed,
canceled, stale, and permission-required turns cannot append orphan assistant
responses. Closing the panel or navigating away disconnects browser SSE only;
Stop is the explicit cancellation action.

Process and answer-delta writes are serialized and fully drained after Codex
settles but before a terminal state or terminal event is written. A stream
persistence failure fails an otherwise successful turn; when Codex also fails,
its safe failure remains authoritative. Closed turn queues reject late Codex
callbacks, so no non-terminal event can be persisted after terminal state.

The fixed turn admission policy permits at most four active-or-reserved turns
across all threads. A second turn for the same thread remains a `409` conflict;
different-thread overflow returns `429 turn_capacity_exceeded` with
`Retry-After: 1` before a Codex client is created. Capacity is released on
startup failure, cancellation, and every detached terminal path.

The fixed event admission policy permits at most 64 KiB per serialized Codex event,
128 events or 1 MiB pending, and 4,096 events or 4 MiB over one turn. Final
answer text is capped at 2 MiB. The durable stream is capped at 4,100 rows and
8 MiB. Exceeding any boundary stops admission and persists a safe failed outcome
when the existing stream still has room for its terminal event; no partial
answer is published as `RESPONSE.md`.

On success, the queue drains and the final answer passes its byte check before
backup intent or answer publication. `RESPONSE.md` plus the completed
`PAIRS.jsonl` revision become durable before the completed turn record and
completed stream event. A manifest or `THREAD.md` finalization fault after that
canonical pair save is a completed answer with a warning and is repaired from
`PAIRS.jsonl`; it is not rewritten as a failed answer. On failure, the failed
pair/turn state is durable before the failed stream event is appended.

SSE replay is delivered one encoded event per pull. A live connection buffers
at most 128 not-yet-delivered events and 3 MiB while replay or a slow consumer
blocks delivery; exceeding that budget unsubscribes and errors only that
connection. Reconnect still reads the bounded durable stream.

The latest durable pair revision is authoritative for `RESPONSE.md`. Startup
recovery rewrites a missing or torn completed response and removes a response
that has no completed revision. Detached turn failures are contained even when
their best-effort failure-state write also fails.

Psychiatrist writes are limited to the memory-local `threads/` subtree. Source
and translated content, taxonomy, Flashbacks, Moments, settings, and SQLite
domain state remain unchanged. Each short thread, pair, response, turn, and
stream publication holds the same memory mutation reservation as deletion.

## Git Backup

Backup is built-in git backup, not a generic hook system. Every built-in git
command uses a command-scoped null `core.hooksPath`, so repository and global
hooks do not run during normal backup, retry, startup recovery, or failsafe
repair.

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
Preparation and enqueue failures are isolated per memory so one corrupt retry
candidate cannot prevent later eligible memories from running.

Backup readiness is tied to the full persisted identity: project/store paths,
remote name and URL, configured and checked-out branch, and already-successful
tracked content. A recreated repository or changed identity requires explicit
recovery rather than silent acceptance. Successful content paths are compared
with one tracked-index snapshot per readiness check rather than starting a git
process per memory.

Recovery is retry-safe. Existing migration targets are accepted only when their
bytes match the source. A push failure after local migration preserves the local
commit and remains retryable after remote repair.

Missing, out-of-scope, or untracked content recorded as successfully backed up
is a content-integrity failure, not path drift. Only a rechecked `missing_file`
case may offer deletion of the orphan SQLite memory row; other cases require
repository/path repair without discarding content.
