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

`{storePath}/.operations/` contains short-lived create/delete journals, and
`{storePath}/.delete-staging/` contains directories moved during deletion.
They are internal crash-recovery state, not memory artifacts or backup inputs.
A deletion journal is cleared only after content, backup, and SQLite state have
been reconciled.

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
cursor pages. File-backed renderability checks group rows by memory or variant
and cap concurrent file reads; route results retain their existing ordering and
complete row set.

`memories` owns URL metadata, content path, extraction/read/backup status, and
timestamps. Tags and categories are many-to-many relations; URL import does not
assign either automatically.

`backup_environment_stamps` records the validated backup identity: resolved
project/store paths, configured remote and its URL when available, branch, and
timestamps. Startup and writes compare paths, remote, configured branch, and
the checked-out branch with this stamp.

`backup_failsafe_alerts` stores the one active critical backup alert. Its kind
distinguishes path drift, missing repository, push failure, and content
inconsistency so only safe recovery actions are offered.

`app_settings` stores singleton local preferences such as translation language,
Codex model, and reasoning effort. These defaults seed future translation jobs;
they do not rewrite historical job records.

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

Pair revisions, manifests, response files, and transcript projections are
written atomically where replacement is required. A completed first answer or
Regenerate enqueues the manifest, transcript, pair files, turn record, and
stream for built-in backup. Backup enqueue failure is reported as a warning and
does not erase the saved answer.

For a pair, the latest valid `PAIRS.jsonl` revision is authoritative over
`RESPONSE.md`; recovery reconciles the response projection before backup retry.

Psychiatrist may write only inside the active memory's `threads/` subtree. It
must not mutate source or translated `CONTENT.md`, taxonomy, Flashbacks,
Moments, settings, translation state, or unrelated memories.
