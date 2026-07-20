# Data And Storage Architecture

TRAUMA uses SQLite and a file-backed memory store. Ownership is domain-specific;
neither storage system is a universal source of truth.

## Ownership Matrix

| Domain | Runtime owner | Store artifact and backup role |
| --- | --- | --- |
| Memory metadata, read state, taxonomy, backup state | SQLite | `CONTENT.md` frontmatter carries only the portable content identity and extraction snapshot. |
| Source reader content | `CONTENT.md` | Canonical readable body and built-in git backup artifact. |
| Translation attempts and current-output identity | SQLite `translation_*` rows | Language-scoped `CONTENT.md` is the canonical translated body; `TRANSLATION_MAP.json` exports projection data. |
| Flashbacks | SQLite `flashbacks` | `FLASHBACKS.json` is a deterministic backup/export projection, never the runtime authority. |
| Moments | SQLite `moments` | No store sidecar currently exists. |
| Psychiatrist threads and pairs | Memory-local files under `threads/` | Canonical thread state, replay data, and built-in git backup artifacts; no SQLite thread rows. |
| Application preferences and external auth references | SQLite | Not part of built-in git backup. |
| Theme selection and open UI state | Browser/UI state | Never persisted to SQLite or the memory store. |

The SQLite database file is outside `storePath` and is not committed by
TRAUMA's built-in git backup. Operators who need database recovery must back it
up at the host level.

## Memory Store Layout

The current store tree is:

```text
{storePath}/memories/{memoryId}/
  CONTENT.md
  FLASHBACKS.json
  {langCode}/
    CONTENT.md
    FLASHBACKS.json
    TRANSLATION_MAP.json
  threads/{threadId}/
    THREAD.json
    THREAD.md
    PAIRS.jsonl
    pairs/{pairId}/
      PROMPT.md
      CONTEXT.json
      RESPONSE.md
    turns/{turnId}.json
    streams/{turnId}.jsonl
```

Some files are created only when their feature is used. All resolved paths must
remain inside the configured `storePath` and the owning memory subtree.

`{storePath}/.operations/` contains short-lived create/delete journals and
variant-specific Flashback export reconciliation intents, while
`{storePath}/.delete-staging/` contains directories moved during deletion.
They are internal crash-recovery state, not memory artifacts or backup inputs.
A deletion journal is cleared only after content, backup, and SQLite state have
been reconciled. A creation row is published only after canonical `CONTENT.md`
and its directory entries have been synced; recovery fails closed when a
surviving creation journal instead finds a row without that canonical file.

## Source Content

`memoryId` is UUID v7 and is not derived from title, URL, tags, or category
names. Source content lives at:

```text
{storePath}/memories/{memoryId}/CONTENT.md
```

`CONTENT.md` contains Markdown plus these frontmatter keys:

- `id`
- `url`
- `title`
- `captured_at`
- `extraction_status`

Tags, categories, read state, backup state, and other runtime metadata remain in
SQLite. `extraction_status` values are defined by
`src/server/memory-status.ts`; frontmatter validation, the SQLite constraint,
and tests must share that contract or have explicit drift coverage.

Remote images stay remote. TRAUMA is not a full offline archive.

## SQLite Model

Runtime tables:

- `memories`
- `memory_creation_idempotency`
- `tags`
- `categories`
- `memory_tags`
- `memory_categories`
- `flashbacks`
- `moments`
- `backup_environment_stamps`
- `backup_failsafe_alerts`
- `app_settings`
- `openai_auth_credentials`
- `translation_jobs`
- `translation_chunks`
- `translation_projection_spans`

Runtime initialization applies and validates bundled migrations before
repositories are exposed. Application code must not observe a partially
initialized schema. Every runtime connection enables foreign keys and WAL and
uses a bounded five-second busy timeout so short write contention is serialized
instead of failing immediately.

Global Moment and Flashback browse reads use deterministic `created_at`/`id`
keyset pages ordered by `created_at DESC, id DESC`. Interactive pages default to
30 rows and reject limits outside `1..100`. Their opaque versioned cursor binds
the collection kind, timestamp, and ID; malformed or cross-collection tokens
never reach a repository query.

Paged Flashback projection scans at most four SQL batches per request and
returns the last scanned cursor even when every candidate is stale, so callers
can advance without an unbounded loop. Each batch reads only its distinct
memory/variant content keys. Paged Moment projection resolves only the SQL page
and reads one table of contents per distinct memory on that page. Legacy full
collection reads remain available only for API compatibility and are not used
by the collection routes or Reader All rail.

`memories` owns URL metadata, content path, extraction/read/backup status, and
timestamps. Tags and categories are many-to-many relations; URL import does not
assign either automatically.

`memory_creation_idempotency` durably binds an optional add-memory UUID v7
request identity to its preflight-normalized request URL before import begins.
The identity is also the intended memory ID. Completed reservations and
recoverable interrupted creations survive process restart and later memory
deletion. A replay can therefore return the existing/recovered row, or fail with
a stable conflict after deletion, but can never silently import and recreate the
memory. A newly inserted reservation is released only when its initial attempt
fails before leaving recoverable durable state, which lets the shell retry that
same failed attempt. The table has no foreign key to `memories` because the
reservation must exist before the memory row and may outlive it.

`backup_environment_stamps` records the validated backup identity: resolved
project/store paths, configured remote and its URL when available, branch, and
timestamps. Startup and writes compare paths, remote, configured branch, and
the checked-out branch with this stamp.

`backup_failsafe_alerts` stores the one active critical backup alert. Its kind
distinguishes path drift, missing repository, push failure, and content
inconsistency so only safe recovery actions are offered. Recovery confirmation
uses an opaque generation derived from the complete persisted alert; replacing
or consuming the alert invalidates an older confirmation.

`app_settings` stores singleton local preferences such as translation language,
Codex model, and reasoning effort. These defaults seed future translation jobs;
they do not rewrite historical job records. The canonical combined translation
defaults mutation validates language, model, and reasoning effort before one
SQLite `UPDATE` writes all three columns. Invalid input writes none of them.
Language-only and Codex-only mutations remain compatibility surfaces, but must
preserve the same singleton row and return the canonical settings projection.

`openai_auth_credentials` is the retained singleton compatibility table for
an external credential reference. Current Codex login state belongs to Codex
app-server; TRAUMA must not copy Codex tokens into SQLite.

## Flashbacks

Flashbacks are variant-local SQLite text ranges rendered into reader HTML.
Their rows include memory and variant identity, selected text and context,
reader offsets, content hash, and timestamps.

- Source rows use `variant_kind = 'source'` with null language and output hash.
- Translated rows use `variant_kind = 'translation'`, a supported BCP 47
  `lang_code`, and the current translation `output_hash`.
- Offsets are measured against the active variant's canonical reader text.
- `content_hash` uses `sha256:<hex>` after line endings are normalized to `\n`.
- A content/output hash mismatch makes the row stale and non-renderable; the
  reader must not guess a new location.

The reader applies current rows as transient marks:

```html
<mark data-flashback-id="...">selected text</mark>
```

The sanitizer allows that element and attribute while removing unsafe HTML.
Normal Flashback writes never mutate `CONTENT.md`.

Toggling off a selection deletes an exact range or shrinks/splits overlapping
rows so unselected text stays Flashbacked. SQLite remains authoritative. After
each successful mutation, TRAUMA writes the active variant's deterministic
export and enqueues it for backup:

```text
{storePath}/memories/{memoryId}/FLASHBACKS.json
{storePath}/memories/{memoryId}/{langCode}/FLASHBACKS.json
```

Before mutating SQLite, the server durably records a variant-specific export
reconciliation intent. Failure before export rename restores the previous
authoritative ranges where necessary; the retained intent makes that rollback
recoverable too. Once both SQLite and the export are durably published, the
intent is cleared. Backup enqueue or backup-status failure does not undo the
toggle. The API returns the normal success fields plus an optional `backup`
warning and `pending` or `failed` status.

Export publication syncs newly created directory entries, temporary-file
bytes, and the final export directory. If final directory sync fails after the
atomic rename, TRAUMA verifies the exact deterministic target bytes and retries
that sync without rewriting. Any remaining post-rename uncertainty keeps the
next SQLite rows authoritative and returns HTTP success with the public
`flashback_export_durability_unconfirmed` warning; internal paths and
confirmation diagnostics are not exposed. Reader and collection callers keep
their committed optimistic state and revalidate from SQLite instead of retrying
or restoring stale UI. Startup reconciliation runs with git backup enabled or
disabled, rereads the active variant rows, and republishes the deterministic
export, including an empty row list after unflashback. Toggle and recovery hold
the same store/memory/artifact-variant lock across SQLite read and publication,
so an older recovery snapshot cannot overwrite a newer toggle. Translation
completion joins that same per-language lock, records an export intent before
making the new output hash current, publishes the new hash's projection
(including an empty list), and includes `FLASHBACKS.json` in translation backup.
An older retained intent therefore cannot republish the previous translation
after a newer translation becomes authoritative.

## Moments

Moments are source-canonical section bookmarks in SQLite. A row owns the memory,
section anchor/title/level/path, optional reader offsets and content hash, and
timestamps. The unique memory/section-anchor relation prevents duplicate
bookmarks for the same source section.

When a Moment is created from a translated reader, the server validates the
translated table of contents and maps the selected section to the matching
source section path and level before persisting it. The translated file is not
a separate Moment authority.

No Moment export file exists in the current contract, so built-in store git
backup does not preserve Moment rows.

## Translation Storage

Translated reader artifacts live beside the source memory:

```text
{storePath}/memories/{memoryId}/{langCode}/CONTENT.md
{storePath}/memories/{memoryId}/{langCode}/TRANSLATION_MAP.json
```

`translation_jobs` owns attempt history and the resolved model/reasoning effort
for each attempt. `translation_chunks` holds durable work state and may hold
translated chunk Markdown while a job is active; completed chunk bodies and
temporary projection JSON are purged after final commit.

Active-job recovery reuses completed chunks only when the job's persisted
prompt-policy/chunker versions and its complete source chunk manifest still
match the current runtime. The manifest includes count, indexes, source chunk
hashes, and ordered block IDs. A mismatch terminalizes that attempt before any
new translation, output commit, or backup work and leaves a fresh attempt
available.

`translation_projection_spans` owns runtime source-to-translated alignment.
Rows are scoped by memory, language, source hash, and output hash so stale files
cannot reuse current projections. `TRANSLATION_MAP.json` is the portable
git-backup/export representation of that data; SQLite remains the runtime
authority for spans.

The language-scoped `CONTENT.md` is committed with a same-directory temporary
file, file sync, and atomic rename. A translation is current only when its
completed job identity, source hash, output hash, and file agree. A durable
`committing` job keeps its chunks so an interrupted output/projection commit can
be replayed before the artifact becomes current.

## Psychiatrist Thread Store

Psychiatrist thread state is file-backed and memory-local. It has no SQLite
thread, pair, turn, or stream rows.

- `THREAD.json` is the machine-readable thread manifest and active-turn state.
- `PAIRS.jsonl` is the append-only pair revision log.
- `PROMPT.md` and `CONTEXT.json` preserve the exact user prompt and context
  provenance for a pair.
- `RESPONSE.md` stores the pair's current completed assistant response.
- `THREAD.md` is the readable transcript projection.
- `turns/{turnId}.json` stores durable turn identity and terminal state.
- `streams/{turnId}.jsonl` stores safe replayable events before SSE fan-out.

Manifests, response files, turn records, context snapshots, prompts, and
transcript projections use a same-directory temporary file, file sync, atomic
rename, and owning-directory sync when they are published or replaced.
`PAIRS.jsonl` and turn streams repair only a torn trailing fragment, append
through an open file handle, and file-sync before the append becomes visible to
callers or stream subscribers. Creating a JSONL file also syncs its owning
directory. JSONL replay is read incrementally behind byte and row limits rather
than loading an unchecked legacy file.

A completed first answer or Regenerate enqueues the manifest, transcript, pair
files, turn record, and stream for built-in backup. Backup enqueue failure is
reported as a warning and does not erase the saved answer.

For a pair, the latest valid `PAIRS.jsonl` revision is authoritative over
`RESPONSE.md`. A new response projection is removed, or a replaced response is
restored, if its completed revision cannot be appended. A crash that leaves the
two out of agreement is reconciled from the latest durable pair revision before
backup retry. The `THREAD.json` manifest and `THREAD.md` transcript are
recoverable projections after a completed pair revision, so a post-save
finalization failure is surfaced as a warning instead of erasing the answer.

Psychiatrist may write only inside the active memory's `threads/` subtree. It
must not mutate source or translated `CONTENT.md`, taxonomy, Flashbacks,
Moments, settings, translation state, or unrelated memories.
