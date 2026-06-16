# 24.1 Codex Conversation Adapter

## Goal

Expose a generic Codex app-server conversation turn interface that Psychiatrist
can use without coupling the new assistant to Brilliant translation chunk
objects.

## Files Likely Owned

- Modify: `src/server/translation/codex-app-server.ts`
- Test: `tests/server/translation/codex-app-server.test.ts`
- Optional create: `src/server/codex/conversation-types.ts` if the shared
  conversation types make `codex-app-server.ts` too large.

## Contract

Add a fakeable interface beside the existing `TranslationClient` contract:

```ts
export interface CodexConversationTurnInput {
  cwdPurpose: "translation" | "psychiatrist";
  input: string;
  model?: string | null;
  networkAccess?: "disabled" | "user_approved_web_sources";
  onEvent?: (event: CodexAppServerEvent) => void;
  reasoningEffort?: CodexReasoningEffort | null;
  sandboxPolicy?: CodexSandboxPolicy;
  appServerThreadId?: string;
}

export interface CodexConversationTurnResult {
  outputText: string;
  appServerThreadId: string;
  appServerTurnId: string;
}

export interface CodexConversationClient {
  cancelTurn(input: {
    appServerThreadId: string;
    appServerTurnId: string;
  }): Promise<void>;
  close?: () => Promise<void> | void;
  probe(): Promise<void>;
  runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult>;
}
```

Rules:

- `CodexAppServerClient` implements both `TranslationClient` and
  `CodexConversationClient`.
- `runConversationTurn()` sends `initialize` and `initialized` before any
  app-server request, exactly like translation.
- If `appServerThreadId` is absent, it starts an ephemeral app-server thread
  before `turn/start`.
- If `appServerThreadId` is present, it reuses that app-server thread and
  starts only a new app-server turn.
- Adapter-facing `appServerThreadId` and `appServerTurnId` are distinct from
  TRAUMA's durable `thread_id` and `turn_id`. They are transient runtime handles
  for cancel/reuse during the current server process and must not become
  durable manifest identity.
- `cwdPurpose: "psychiatrist"` uses a job-scoped empty runtime directory under
  the same runtime root pattern as translation, never the project root or memory
  store root.
- `approvalPolicy`, `approvalsReviewer`, and sandbox defaults remain locked
  down. Psychiatrist turns do not grant filesystem write access.
- Psychiatrist turns must not grant shell access, local file edit tools, local
  filesystem browsing, project-root access, memory-store access, or MCP tools
  that can mutate local state.
- `networkAccess` defaults to `"disabled"`. The adapter may enable network only
  when the caller passes `"user_approved_web_sources"` for a turn after the user
  explicitly approved web search/source lookup.
- When network remains disabled and the app-server schema can express network
  denial, send that field. If the schema cannot express it, omit network-capable
  tools and document the minimum-privilege payload before implementation.
- TRAUMA server code, not the app-server runtime, writes thread artifacts and
  stream artifacts under the owning memory's `threads/` subtree after
  validating route, memory identity, variant identity, prompt policy version,
  and context state.
- The selected `model` and `reasoningEffort` pass through using the same stable
  app-server field names as translation.
- Final answer text comes from completed app-server item content, not streamed
  deltas.
- Streamed answer deltas and app-server status/process notifications that are
  safe for user display are forwarded through `onEvent`.
- Hidden chain-of-thought, raw app-server payloads, credential paths, local
  paths, and tool internals must not be forwarded as Psychiatrist process
  events. If the app-server distinguishes hidden reasoning from visible
  summaries, forward only the visible summary/status form.
- Raw app-server notifications stay parsed inside `codex-app-server.ts`.

## Implementation Steps

1. Add failing tests in `tests/server/translation/codex-app-server.test.ts`.
   Cover new thread creation, existing thread reuse, event forwarding, final
   text extraction, safe process-event forwarding, hidden-reasoning filtering,
   app-server id naming that does not collide with TRAUMA `thread_id`/`turn_id`,
   model/effort pass-through, cancellation, denied shell/file policy, disabled
   network default, and the explicit user-approved network flag.

2. Extract or reuse the existing private request helpers so translation and
   conversation turns share initialization, request timeout, model field names,
   and `turn/interrupt`.

3. Implement `runConversationTurn()` with the contract above.

4. Keep `translateChunk()` behavior unchanged by having it continue to call the
   existing translation-specific prompt/output parsing path.

5. Add a narrow fake-app-server assertion that a Psychiatrist turn never
   includes the project root, memory store root, shell-enabled tool declarations,
   file-edit tool declarations, or a network-enabled payload unless
   `networkAccess` is `"user_approved_web_sources"`.

6. Run:

```bash
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
mise exec -- bun run typecheck
```

Expected: both commands pass, and all pre-existing translation app-server tests
continue to pass.

## Acceptance Criteria

- A fake Codex app-server can exercise generic assistant turns without creating
  translation chunks.
- Brilliant translation still uses the existing `TranslationClient` surface.
- The new adapter never exposes app-server endpoint details to frontend code.
- Psychiatrist app-server turns are minimum-privilege: no shell, no local file
  editing, no local filesystem roots, and network disabled unless the user
  approved web-source access for that turn.
- Psychiatrist can stream user-visible process/status events without exposing
  hidden chain-of-thought or raw app-server internals.
