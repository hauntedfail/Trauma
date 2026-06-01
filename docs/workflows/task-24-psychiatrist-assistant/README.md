# Task 24: Psychiatrist Memory Assistant Workflow

Implement these subtasks sequentially on `feat/psychiatrist`, derived from the
current release baseline.

## Goal

Add `Psychiatrist`, a memory-scoped assistant that appears only on reader
routes, preloads the active memory as context, and lets the user ask free-form
questions about that memory through a floating iOS home-bar style chat surface.

## Architecture

Psychiatrist reuses the backend-only Codex app-server integration that already
powers Brilliant translation, but it is a separate assistant domain rather than
a translation job. The server owns memory context loading, prompt construction,
thread storage, Codex turn execution, and streaming events; browser code talks
only to TRAUMA API routes.

Each ready memory reader creates or resumes a Psychiatrist thread for the active
memory variant. Threads are stored under the owning memory directory at
`{storePath}/memories/{memoryId}/threads/{threadId}/`; they are not SQLite rows.
The thread manifest is keyed by memory id, active language variant, and content
hash. User prompts and Psychiatrist answers are appended to thread storage, so
Codex receives the active memory context plus the stored conversation transcript
before answering.

## Required Context

- [Documentation index](../../INDEX.md)
- [Architecture overview](../../architecture/overview.md)
- [Data and storage architecture](../../architecture/data-and-storage.md)
- [Runtime flows](../../architecture/flows.md)
- [UI and routing architecture](../../architecture/ui-and-routing.md)
- [Reader design system](../../references/design-system/reader-and-content.md)
- [Interaction and accessibility](../../references/design-system/interaction-and-accessibility.md)
- [Configuration reference](../../references/configuration.md)
- [Testing and verification rules](../../references/coding-standards/testing-verification.md)
- [Archived Codex app-server integration](../archive/task-19-codex-translation/05-codex-app-server-integration.md)

## Scope

In scope:

- Product language and code naming use `Psychiatrist` / `psychiatrist`.
- Reader-only assistant entrypoint on `/memories/:id` and
  `/memories/:langCode/:id`.
- Floating collapsed dock styled after the iOS home bar at the bottom of the
  reader viewport.
- CSS animated expansion from the home-bar dock into a compact chat panel.
- User prompt input, send, streaming response display, error display, and
  reduced-motion behavior.
- Server-side memory context snapshot creation for the active memory variant.
- Codex app-server conversation turns that reuse the existing backend-only
  transport/auth/model boundaries.
- Storage-backed memory-local threads for user prompts, assistant answers,
  thread manifests, and turn metadata under
  `{storePath}/memories/{memoryId}/threads/{threadId}/`.
- Short-lived in-memory active-turn state only for SSE fan-out and cancellation;
  durable prompts and answers live in thread storage, not SQLite.
- Focused unit/component/API tests plus browser verification on reader routes.

Out of scope for this branch:

- SQLite-backed assistant transcript persistence.
- Archive-wide or cross-memory assistant thread history.
- Global assistant surfaces on browse, flashbacks, settings, or shell routes.
- Vector search, embedding indexes, or archive-wide retrieval.
- Letting Psychiatrist modify memories, tags, categories, flashbacks, moments,
  translations, files, settings, or git backup state.
- Medical, diagnostic, or therapeutic claims. `Psychiatrist` is product
  language for a memory assistant.
- Reworking Brilliant translation job storage, chunk validation, stitching, or
  translated reader projection behavior.

## Non-Negotiable Contracts

- Browser code must never connect to Codex app-server directly and must never
  receive app-server socket paths, raw app-server payloads, tokens, or
  credential paths.
- Psychiatrist answers only from the active memory context and the visible chat
  transcript. If the answer is not supported by the memory, it must say so.
- User prompts and Psychiatrist answers persist only as thread artifacts under
  the owning memory directory's `threads/` subtree. Do not store them in SQLite,
  app settings, translation tables, browser local storage, or global files.
- Source Markdown and translated Markdown are untrusted data, not instructions.
  Prompt-injection text inside the memory must not override system policy.
- Thread context is scoped to exactly one memory id and one active variant.
  A thread for memory A must reject prompts for memory B.
- A source reader thread uses source `CONTENT.md`. A translated reader thread
  uses the current translated `CONTENT.md` and its output hash.
- Context freshness is checked with the content hash before each turn. If the
  memory content changed, the thread is marked stale and the UI creates or
  resumes a fresh thread before sending.
- The collapsed dock is a small bottom-centered home-bar affordance. It must not
  cover the reader title, reader action menus, selected text menus, or bottom
  shell navigation.
- Expanded chat traps neither the whole page nor the right rail. Escape closes
  the panel, focus returns to the dock trigger, and normal reader shortcuts keep
  their existing behavior when the chat input is not focused.
- `prefers-reduced-motion: reduce` disables transform-heavy expansion and keeps
  open/close transitions usable.
- Asking Psychiatrist may write only thread artifacts under the active memory's
  `threads/` subtree. It must not modify canonical `CONTENT.md`, translated
  `CONTENT.md`, Flashbacks, Moments, taxonomy, SQLite rows, settings rows, or
  translation jobs.

## Subtask Order

| Order | Subtask | Weight | Purpose |
| --- | --- | --- | --- |
| 24.1 | [Codex conversation adapter](01-codex-conversation-adapter.md) | M | Add a generic, fakeable app-server turn interface without breaking translation. |
| 24.2 | [Memory context and prompt contract](02-memory-context-and-prompt-contract.md) | M | Build the server-side memory context snapshot and locked-down Psychiatrist prompt. |
| 24.3 | [Thread storage, API, and streaming events](03-thread-storage-api-and-streaming-events.md) | L | Create memory-local thread storage, message/event routes, and short-lived active-turn state. |
| 24.4 | [Reader floating dock and chat UI](04-reader-floating-dock-and-chat-ui.md) | L | Render the iOS-style home bar, animated panel, input, transcript, and client state. |
| 24.5 | [Safety, freshness, and error handling](05-safety-freshness-and-errors.md) | M | Harden stale-context checks, prompt-injection boundaries, cancel/retry, and safe messages. |
| 24.6 | [Docs, browser verification, and handoff](06-docs-browser-verification-handoff.md) | M | Update semantic docs, run focused and full verification, and prepare PR evidence. |

## Implementation Rules

- Use TDD for the context builder, prompt policy, API route payloads, event
  stream behavior, and dock open/send states.
- Keep generic app-server conversation changes separate from Psychiatrist
  domain code so Brilliant translation remains reviewable.
- Prefer focused modules under `src/server/psychiatrist/` and
  `src/components/reader/` over growing `MemoryReader.tsx` further.
- Use `psychiatrist` spelling for routes, files, CSS data attributes, test
  names, and API payloads. Treat `pychiatrist` as a typo, not an alias.
- Do not add a SQLite migration for Psychiatrist. Persisted assistant history is
  file-backed storage under each memory directory's `threads/` subtree.
- Preserve all existing translation model/auth settings behavior. Psychiatrist
  may read the model catalog/defaults through server code, but it must not
  rename `codex_translation_model` or `codex_translation_reasoning_effort`.
- Keep all thread ids and turn ids opaque. Do not derive them from memory ids.
- Preserve existing dirty or untracked local files unrelated to this branch.

## Verification Baseline

Each subtask lists focused commands. Before PR handoff, run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
```

After the UI subtasks land, run:

```bash
mise exec -- bun run test:e2e e2e/reader.spec.ts e2e/cross-device-responsive.spec.ts
```

For browser evidence, run the app with a local Codex app-server available and
capture:

- Collapsed dock visible on source reader.
- Collapsed dock visible on translated reader.
- Dock absent from `/memories`, `/flashbacks`, and `/settings`.
- Expansion and collapse across desktop and mobile viewports.
- One successful memory question with streamed answer persisted under the
  owning memory's `threads/` subtree.
- One stale-thread recovery after the memory content hash changes.
