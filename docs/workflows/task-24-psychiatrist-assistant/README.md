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
thread storage, Codex turn execution, runtime permission policy, and streaming
events; browser code talks only to TRAUMA API routes.

Each ready memory reader creates or resumes a Psychiatrist thread for the active
memory variant. Threads are stored under the owning memory directory at
`{storePath}/memories/{memoryId}/threads/{threadId}/`; they are not SQLite rows.
The thread manifest is keyed by memory id, active language variant, and content
hash. The durable transcript is a sequence of pairs: one accepted user prompt
followed by the corresponding Psychiatrist response. Pending, failed, or
canceled pairs may lack an assistant response, but an assistant response must
never exist without the user prompt it answers.

Psychiatrist behavior is governed by a repo-local policy skill, modeled after
`reader-translate`. The implementation branch should create a `psychiatrist`
skill and deterministic prompt builder so Codex app-server turns receive the
active memory context, the stored pair transcript, and the locked-down assistant
policy without granting the app-server runtime project or memory-store file
access.

Running turns persist their user-visible stream state under the same memory
thread directory. The UI renders answer deltas and safe process/reasoning
events as they arrive, can replay them after navigation or browser reload, and
does not cancel work unless the user explicitly presses Stop. Regeneration is a
same-pair operation: it reruns the stored prompt against the stored context,
overwrites the existing response Markdown artifact for that pair/thread, and
queues git backup with a regenerate-specific commit action.

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
- Streaming display for the full user-visible Psychiatrist process: answer
  deltas, safe process/reasoning events, status transitions, stop state, and
  regenerate state.
- Server-side memory context snapshot creation for the active memory variant.
- Codex app-server conversation turns that reuse the existing backend-only
  transport/auth/model boundaries.
- Pair-managed memory-local threads for user prompts, assistant answers, thread
  manifests, and turn metadata under
  `{storePath}/memories/{memoryId}/threads/{threadId}/`.
- Short-lived in-memory active-turn indexes only for SSE fan-out, cancellation,
  and app-server turn ids; durable prompts, answers, and replayable stream
  events live in thread storage, not SQLite.
- A repo-local `psychiatrist` skill and validation tests that define the
  assistant's memory-scoped behavior, no-write policy, prompt-injection rules,
  network permission boundary, and web-source citation expectations.
- Codex app-server runtime policy for Psychiatrist: no local file editing, no
  shell access, no project/store filesystem roots, and network access only for
  a turn where the user explicitly grants web search/source lookup permission.
- Durable stream replay for running turns so leaving the memory route, returning
  later, or reloading the page preserves the visible output and process state.
- Explicit Stop behavior: the submit button becomes a Stop button while the
  turn is running, and only that action requests cancellation.
- Per-response Regenerate behavior that reruns the same prompt and stored
  context for the existing pair, overwrites the existing thread-managed Markdown
  response artifact, and enqueues git backup with an appropriate regenerate
  commit message.
- Focused unit/component/API tests plus browser verification on reader routes.

Out of scope for this branch:

- SQLite-backed assistant transcript persistence.
- Archive-wide or cross-memory assistant thread history.
- Global assistant surfaces on browse, flashbacks, settings, or shell routes.
- Vector search, embedding indexes, or archive-wide retrieval.
- Letting Psychiatrist modify memories, tags, categories, flashbacks, moments,
  translations, files, settings, or git backup state.
- Creating new threads or pairs for Regenerate. Regenerate updates the existing
  pair/thread artifacts only.
- Shell execution, local file editing, or local filesystem browsing from inside
  the Codex app-server turn.
- Network access without explicit user approval for the current turn.
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
- Durable thread history is pair-shaped. Each pair is one accepted user prompt
  and zero or one Psychiatrist response for the same turn. A completed response
  must reference the pair it answers; failed, canceled, or stale turns must not
  append orphan assistant messages.
- User-visible streaming state is durable while a turn is running. A reader
  route unmount, memory switch, panel close, or browser reload must not cancel
  the turn and must be able to replay the stored stream when the user returns.
- The UI may display safe process/reasoning events emitted by the server, but it
  must not expose hidden chain-of-thought, raw app-server payloads, credentials,
  or local paths.
- While a turn is running, the prompt submit button becomes a Stop button. Stop
  is the only browser action that requests turn interruption.
- Regenerate is available for each completed Psychiatrist response. It reuses
  the same user prompt and the stored context snapshot for that pair, keeps the
  same `pair_id` and `thread_id`, and overwrites the existing response Markdown
  artifact instead of creating a new pair or thread.
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
- Regenerate may overwrite only the existing response Markdown artifact and the
  thread Markdown projection for the same pair/thread. It must enqueue git
  backup for those thread artifacts with a regenerate-specific backup reason.
- The Codex app-server turn used by Psychiatrist must not have shell access,
  local file edit tools, project-root access, memory-store access, or implicit
  network access.
- Network access is denied by default. If the active memory context and user
  prompt require current web sources, Psychiatrist may ask for user permission;
  only a user-approved turn may use web search or fetch remote sources, and the
  answer must expose source citations or state that no reliable source was
  found.
- The `psychiatrist` skill is the durable policy source for assistant behavior.
  Runtime prompts must mirror that policy deterministically, similar to
  Brilliant translation's `reader-translate` policy pattern.

## Subtask Order

| Order | Subtask | Weight | Purpose |
| --- | --- | --- | --- |
| 24.1 | [Codex conversation adapter](01-codex-conversation-adapter.md) | M | Add a generic, fakeable app-server turn interface without breaking translation. |
| 24.2 | [Memory context and prompt contract](02-memory-context-and-prompt-contract.md) | M | Build the server-side memory context snapshot and locked-down Psychiatrist prompt. |
| 24.7 | [Psychiatrist skill and runtime policy](07-psychiatrist-skill-and-runtime-policy.md) | M | Extend the 24.2 prompt/context scaffolding with the policy skill, deterministic prompt provenance, no-shell/no-file runtime contract, and user-approved network boundary before downstream route, storage, and UI consumers rely on it. |
| 24.3 | [Thread storage, API, and streaming events](03-thread-storage-api-and-streaming-events.md) | L | Create memory-local pair storage, message/event routes, and short-lived active-turn state. |
| 24.4 | [Reader floating dock and chat UI](04-reader-floating-dock-and-chat-ui.md) | L | Render the iOS-style home bar, animated panel, input, transcript, and client state. |
| 24.5 | [Safety, freshness, and error handling](05-safety-freshness-and-errors.md) | M | Harden stale-context checks, prompt-injection boundaries, cancel/retry, and safe messages. |
| 24.8 | [Streaming continuity, Stop, Regenerate, and backup](08-streaming-continuity-regenerate-backup.md) | L | Persist visible process streams, resume running turns after navigation/reload, add Stop and Regenerate semantics, and back up regenerated Markdown artifacts. |
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
- Store transcript history as pair records, not free-floating role messages.
  The storage API may expose messages for UI convenience, but the source of
  truth is the prompt/response pair.
- Preserve all existing translation model/auth settings behavior. Psychiatrist
  may read the model catalog/defaults through server code, but it must not
  rename `codex_translation_model` or `codex_translation_reasoning_effort`.
- Keep all thread ids and turn ids opaque. Do not derive them from memory ids.
- Keep Psychiatrist app-server turns minimum-privilege: no shell, no local file
  editing, no project/store roots, and network disabled unless the user grants a
  per-turn web-source permission.
- Do not treat browser disconnects as cancellation. A turn continues until it
  completes, fails, times out, or the user explicitly presses Stop.
- Regenerate must preserve `thread_id`, `pair_id`, stored prompt, stored
  context snapshot, and memory variant metadata.
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
  owning memory's `threads/` subtree as a user-prompt/assistant-response pair.
- One running turn that continues after leaving the memory route and replays its
  process/answer stream after returning.
- One running turn that continues after browser reload and reconnects to the
  same `turn_id`.
- One Stop action that changes the submit button to Stop during running state
  and cancels only after explicit click.
- One Regenerate action that overwrites the same response Markdown artifact,
  keeps the same pair/thread ids, and enqueues git backup with regenerate action
  text.
- One stale-thread recovery after the memory content hash changes.
- One network-denied turn that does not attempt web access and one
  user-approved web-source turn that records safe source metadata with the pair.
