# Glossary

## Domain Terms

`memory`
: One saved bookmark/content item.

`memories`
: The collection of saved memory items and the canonical browse route.

`CONTENT.md`
: The readable markdown file for one memory.

`storePath`
: Directory that contains source/translated reader files, portable metadata
exports, and memory-local Psychiatrist thread artifacts.

`projectPath`
: Git working directory used by built-in backup for explicitly enqueued
`storePath` artifacts.

`category`
: Curated grouping. A memory can have multiple categories.

`tag`
: Ad-hoc label. A memory can have multiple tags.

`Flashback`
: Product term for a user-created text marker inside reader content.

`unflashback`
: Toggle action caused by selecting reader text that is already covered by a
Flashback marker. Only the selected range is removed from Flashback coverage;
surrounding marked text remains marked.

`/flashbacks`
: Canonical Flashback marker browse route. It lists marked excerpts with muted
prefix/suffix context and the source memory title.

`Moment`
: Product term for a saved reader section/chapter bookmark. This replaces the
older use of `Flashback` for section bookmarks.

`/moments`
: Canonical Moment browse route for section bookmarks.

`bookmark`
: Generic behaviour description for what TRAUMA product language calls a
`Moment`. Prefer `Moment` in user-facing docs.

`Psychiatrist`
: TRAUMA product language for a memory-scoped reader assistant mounted in the
on-demand reader Psychiatrist sheet (and backing in-situ AI margin notes). It
answers from the active memory context and current thread pair history; it is
not a medical professional and does not provide diagnosis or treatment advice.

`Today`
: Default `/memories` browse lane holding a small set of picked items
(`triage_state = 'today'`) for active reading, capped without unread debt
counters.

`Shelf`
: Ephemeral landing lane (`/memories?lane=shelf`, `triage_state = 'shelf'`) for
newly captured memories awaiting deferred triage (`p` Today, `l` Library,
`x` Archive, `u` Undo).

`Library`
: Permanent kept collection (`/memories?lane=library`,
`triage_state = 'library'`) with search and an on-demand `Filters` popover for
categories, tags, and Flashbacks.

`Inspector` *(removed)*
: Retired multi-tab right-side reader drawer dismantled under revised D5 into
co-located micro-surfaces (left landmark rail for Outline + Marks, inline
`+ Translate` popover, quiet `⋯` overflow popover for rare metadata/actions,
in-situ AI margin notes, and an on-demand Psychiatrist sheet).

`Headless Agent API`
: Versioned JSON REST and SSE contract under `/api/agent/v1/*` (`context`,
`memories/:memoryId`, `triage`, `ask`) that exposes TRAUMA's shared reading
state to external agents and CLI tools. See [Agent API](agent-api.md).

## Status Fields

`triage_state`
: Focus-first browse lifecycle state for a memory: `shelf`, `today`, `library`,
or `archive`. New captures land in `shelf` without premature taxonomy prompts.

`last_position`
: Persisted JSON reading position (`variant`, `headingId`, `paragraphIndex`,
`scrollRatio`, `updatedAt`) owned by the core reader for silent reopen restore
and consumed by the optional `resumption-beacon` plugin for visual cues.

`word_count`
: Persisted source word count used to display neutral length buckets
(`short` / `medium` / `long`, exposed as `lengthBucket` in API responses) rather
than countdown timers. Nullable (`null`) when no word count is stored, such as
for a failed extraction or a memory captured before migration `0024` until
`bun run db:migrate` has run its backfill.

`extraction_status`
: Import/extraction state for a memory. It distinguishes successful extraction
from partial or failed link-only creation. Current values are `pending`,
`success`, `link_only`, and `failed`; `src/server/memory-status.ts` is the
code source of truth.

`extraction_error`
: Human-readable or diagnostic extraction failure detail.

`backup_status`
: Git backup state for the memory content.

`last_backup_at`
: Timestamp of the last successful backup.

`last_backup_error`
: Diagnostic detail for the last failed backup attempt.
