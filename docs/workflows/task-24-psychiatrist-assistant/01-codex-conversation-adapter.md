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
  onEvent?: (event: CodexAppServerEvent) => void;
  reasoningEffort?: CodexReasoningEffort | null;
  sandboxPolicy?: CodexSandboxPolicy;
  threadId?: string;
}

export interface CodexConversationTurnResult {
  outputText: string;
  threadId: string;
  turnId: string;
}

export interface CodexConversationClient {
  cancelTurn(input: { threadId: string; turnId: string }): Promise<void>;
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
- If `threadId` is absent, it starts an ephemeral thread before `turn/start`.
- If `threadId` is present, it reuses that thread and starts only a new turn.
- `cwdPurpose: "psychiatrist"` uses a job-scoped empty runtime directory under
  the same runtime root pattern as translation, never the project root or memory
  store root.
- `approvalPolicy`, `approvalsReviewer`, and sandbox defaults remain locked
  down. Psychiatrist turns do not grant filesystem write access.
- The selected `model` and `reasoningEffort` pass through using the same stable
  app-server field names as translation.
- Final answer text comes from completed app-server item content, not streamed
  deltas.
- Streamed deltas are forwarded only through `onEvent`.
- Raw app-server notifications stay parsed inside `codex-app-server.ts`.

## Implementation Steps

1. Add failing tests in `tests/server/translation/codex-app-server.test.ts`.
   Cover new thread creation, existing thread reuse, event forwarding, final
   text extraction, model/effort pass-through, and cancellation.

2. Extract or reuse the existing private request helpers so translation and
   conversation turns share initialization, request timeout, model field names,
   and `turn/interrupt`.

3. Implement `runConversationTurn()` with the contract above.

4. Keep `translateChunk()` behavior unchanged by having it continue to call the
   existing translation-specific prompt/output parsing path.

5. Run:

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
