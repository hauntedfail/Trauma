# Task 19X: Translation Validation Feedback Repair Workflow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Brilliant translation validation failures actionable and retryable without weakening Markdown preservation guarantees.

**Architecture:** Keep Task 19U's segment-only translation and deterministic Markdown reassembly architecture. Add structured validation diagnostics at the validator boundary, persist safe diagnostics through the existing translation error JSON, and feed the previous failure summary into fresh chunk retry prompts. Do not store raw Codex output or completed translated article bodies.

**Tech Stack:** TypeScript, Bun, Vitest, existing `unified`/`remark` Markdown parser, existing Codex app-server translation client, existing SQLite `translation_jobs.error` and `translation_chunks.error` JSON columns.

---

## Status

- State: Implemented in this branch; focused verification and live Amp retry
  passed. Full `bun run verify` handoff remains pending until the unrelated
  runtime `package.json` host contract drift is resolved.
- Base workflow: [Task 19 Codex translation](task-19-codex-translation.md)
- Depends on: [Task 19U segment reassembly](task-19-codex-translation-segment-reassembly.md)
- Related context:
  - [Task 19 chunk validation and retry logic](task-19-codex-translation/09-chunk-validation-and-retry-logic.md)
  - [Task 19 prompt and validation contract](task-19-codex-translation/contracts/06-codex-prompt-and-validation.md)
  - [Task 19 error handling and cancellation](task-19-codex-translation/15-error-handling-and-cancellation.md)
  - [Coding standards](../references/coding-standards/INDEX.md)
  - [Verification strategy](../quality/verification.md)

## Current Failure To Reproduce

Runtime database: `/Users/vvx/.trauma/trauma.sqlite`

Failing memory:

- Memory id: `019e5eee-566c-7732-9182-68ad075f3276`
- Title: `Amp Owner's Manual`
- URL: `https://ampcode.com/manual`
- Language: `ja-JP`
- Model: `gpt-5.3-codex-spark`
- Reasoning effort: `xhigh`

Observed failed jobs:

```text
019e5eee-8853-74fa-bb7d-4a091158aefd
chunk_index=1
retry_count=3
error={"code":"validation_failed","message":"Codex output changed inline code.","action":"retry"}

019e5ef6-bac4-7223-9bae-32400eebfb54
chunk_index=3
retry_count=3
error={"code":"validation_failed","message":"Codex output changed block structure.","action":"retry"}
```

The app-server path and auth path were working. Codex returned schema-valid
segment JSON. TRAUMA rejected the locally reassembled Markdown during semantic
validation.

Resolved live retry evidence from this branch:

```text
019e5fa5-9b46-775f-98b2-4a54dc63a9ba
status=complete
output_path=memories/019e5eee-566c-7732-9182-68ad075f3276/ja-JP/CONTENT.md
output_hash=sha256:20a495929da4ecfa28779b788ae2fc802eab1179209238835edb7e793769ebf9
translation_projection_spans=921
```

All chunks for the completed job were purged after commit. The final
`ja-JP/CONTENT.md` and `TRANSLATION_MAP.json` were present under the live
memory variant, and no raw retry diagnostics or invalid model output were
persisted in the committed translated variant.

## Diagnosis

The validator is strict in the right direction: it must reject translated output
that changes inline code, code fences, tables, links, destinations, HTML, math,
footnotes, or Markdown block structure.

The insufficient implementation is the validation feedback loop:

1. Validation errors collapse to coarse messages such as
   `Codex output changed block structure`.
2. Persisted chunk/job errors do not identify the failing chunk entry, expected
   fingerprint kind/value, actual fingerprint kind/value, segment id, block id,
   or safe protected-span summary.
3. Retry attempts rebuild the same prompt instead of including the previous
   structured validation failure summary.
4. Tests cover rejection but do not prove that retry prompts receive actionable
   validator feedback.

## Affected Scope

Primary implementation files:

- `src/server/translation/errors.ts`
  - Add a typed validation diagnostic error shape.
  - Keep ordinary `TranslationOutputValidationError` construction ergonomic for
    existing tests.
- `src/server/translation/structure-fingerprint.ts`
  - Include safe expected/actual fingerprint diagnostics when structure
    comparison fails.
  - Do not include raw source chunks or raw model output.
- `src/server/translation/prompt.ts`
  - Carry validation diagnostics from segment validation and structure
    fingerprinting.
  - Add retry-prompt support that accepts the previous failure summary and the
    expected segment ids.
- `src/server/translation/runner.ts`
  - Preserve the latest failed attempt's safe diagnostic.
  - Pass that diagnostic into the next fresh chunk retry prompt.
  - Persist the same safe diagnostic in chunk/job error JSON.
- `src/server/translation/types.ts`
  - Add optional diagnostic metadata to `TranslationJobSnapshotError` and
    `TranslationPersistedError`.
  - Keep the current `code`, `message`, and `action` fields stable for UI/API
    consumers.
- `src/server/db/repositories.ts`
  - Accept and parse the optional persisted diagnostic field.
  - No migration is needed because the existing `error` columns store JSON text.

Primary tests:

- `tests/server/translation/prompt.test.ts`
- `tests/server/translation/structure-fingerprint.test.ts`
- `tests/server/translation/runner.test.ts`
- `tests/server/translation/translation-repositories.test.ts`

Optional documentation updates if implementation changes contracts:

- `docs/workflows/task-19-codex-translation/09-chunk-validation-and-retry-logic.md`
- `docs/workflows/task-19-codex-translation/contracts/06-codex-prompt-and-validation.md`
- `docs/workflows/task-19-codex-translation/15-error-handling-and-cancellation.md`

## Out Of Scope

- Relaxing validation so changed Markdown structure, inline code, code fences,
  destinations, HTML, math, tables, or footnotes can pass.
- Replacing Task 19U's segment-only output schema with full Markdown output.
- Redesigning chunking, stitching, translated reader routing, Flashbacks,
  Moments, backup, auth, model controls, or Codex app-server transport.
- Adding a new database table or migration for attempt logs.
- Persisting raw Codex prompts, raw Codex responses, source chunks, translated
  article bodies, app-server URLs, auth state, tokens, or credential paths.
- Committing the imported `Amp Owner's Manual` `CONTENT.md` or raw failed model
  output as a fixture. Use synthetic fixtures that reproduce the structural
  pattern instead.
- Browser UI redesign. Existing user-facing copy may remain coarse as long as
  server-side diagnostics are actionable and safe.

## Correction Strategy

### 1. Keep strict validation, add structured diagnostics

Validation should continue to throw `TranslationOutputValidationError`, but the
error should optionally carry a safe diagnostic:

```ts
interface TranslationValidationDiagnostic {
  kind:
    | "markdown_structure"
    | "protected_span"
    | "segment_schema"
    | "segment_length_ratio"
    | "projection";
  message: string;
  chunkIndex: number;
  segmentId?: string;
  blockId?: string;
  sourceEntry?: {
    kind: string;
    valuePreview: string;
  };
  translatedEntry?: {
    kind: string;
    valuePreview: string;
  };
  protectedSpan?: {
    kind: string;
    valuePreview: string;
  };
}
```

`valuePreview` must be short, deterministic, and redacted enough for logs and
SQLite. It may include code-like atoms such as `` `AGENTS.md` `` or
`inline_code`, but it must not include whole source chunks or full translated
paragraphs.

### 2. Persist diagnostics without breaking existing consumers

Extend translation error JSON with optional diagnostics:

```ts
interface TranslationPersistedError {
  code: PersistableTranslationErrorCode;
  message: string;
  action?: TranslationErrorAction;
  reason?: TranslationUnavailableReason | string;
  diagnostics?: TranslationValidationDiagnostic[];
}
```

Existing UI/API consumers should keep using `code`, `message`, and `action`.
The diagnostic field is for server-side investigation, tests, and retry prompt
construction.

### 3. Feed previous validation failure into retry prompts

Each chunk attempt still starts a fresh ephemeral Codex thread. For attempts
after the initial attempt, `buildTranslationPrompt()` should receive a compact
retry context:

```ts
interface TranslationRetryContext {
  attempt: number;
  previousError: TranslationJobSnapshotError;
}
```

The prompt should add a short retry section before the source chunk:

```text
Retry correction:
The previous output was rejected by TRAUMA validation.
Do not add Markdown syntax inside translated_text unless it exists in the source segment.
Preserve the expected segment ids and translate only prose.
Validation diagnostics:
...
```

The retry section must include only structured, safe diagnostics and expected
segment ids. It must not include raw invalid model output.

### 4. Add targeted synthetic regression fixtures

Create compact fixtures in tests, not durable article fixtures, covering the
Amp failure shape:

- A table/list chunk with many inline code spans such as `` `AGENTS.md` ``,
  `$HOME`, and shell commands.
- A skill/MCP chunk with code fences, JSON, YAML frontmatter examples, and
  inline code references.
- A model output that is schema-valid but introduces backticks or structural
  Markdown in a translated segment.

Tests should prove:

- The validator rejects the mutated output.
- The thrown/persisted error contains a diagnostic.
- The retry prompt includes that diagnostic.
- The retry prompt does not include raw invalid translated output.
- A corrected retry can pass and commit.

## Implementation Tasks

### Task 1: Diagnostic Error Model

**Files:**

- Modify: `src/server/translation/errors.ts`
- Modify: `src/server/translation/types.ts`
- Test: `tests/server/translation/prompt.test.ts`

- [x] Add `TranslationValidationDiagnostic` and optional `diagnostics` fields
      to translation error types.
- [x] Extend `TranslationOutputValidationError` so callers can pass
      `{ diagnostics }`, while existing `new TranslationOutputValidationError(message)`
      call sites continue to work.
- [x] Add a focused test that catches a validation error and asserts the
      diagnostic array is present for a Markdown structure failure.
- [x] Run:

```bash
bun run test tests/server/translation/prompt.test.ts
```

Expected: the new test fails before implementation and passes after.

### Task 2: Structure Fingerprint Diagnostics

**Files:**

- Modify: `src/server/translation/structure-fingerprint.ts`
- Test: `tests/server/translation/structure-fingerprint.test.ts`

- [x] When fingerprint entry counts differ, include the mismatch index and
      expected/actual entry presence.
- [x] When entry kinds differ, include expected and actual kind previews.
- [x] When entry values differ, include expected and actual value previews.
- [x] Add tests for inline-code mutation and block-structure mutation.
- [x] Run:

```bash
bun run test tests/server/translation/structure-fingerprint.test.ts
```

Expected: diagnostics identify the failure without exposing full Markdown
documents.

### Task 3: Prompt Retry Context

**Files:**

- Modify: `src/server/translation/prompt.ts`
- Test: `tests/server/translation/prompt.test.ts`

- [x] Add an optional retry context parameter to `buildTranslationPrompt()`.
- [x] Render a compact retry-correction section only when retry context is
      supplied.
- [x] Include diagnostic kind, message, chunk index, segment id, block id, and
      short expected/actual previews when present.
- [x] Include expected segment ids in the retry section.
- [x] Add tests proving initial prompts are unchanged and retry prompts contain
      diagnostics but not raw failed translated output.
- [x] Run:

```bash
bun run test tests/server/translation/prompt.test.ts
```

Expected: initial prompt tests still pass; retry prompt tests pass.

### Task 4: Runner Retry Feedback Loop

**Files:**

- Modify: `src/server/translation/runner.ts`
- Test: `tests/server/translation/runner.test.ts`

- [x] Track the latest persisted error from a failed attempt inside
      `translateAndPersistChunk()`.
- [x] Pass retry context to `buildTranslationPrompt()` when `attempt > 0`.
- [x] Preserve diagnostics in `toPersistedError()` and `toPersistableError()`.
- [x] Add a fake translation client that fails validation on the first attempt,
      records prompts, then returns corrected output.
- [x] Assert the second prompt contains the validation diagnostic and the job
      completes.
- [x] Assert cancellation still prevents retry after a failed chunk.
- [x] Run:

```bash
bun run test tests/server/translation/runner.test.ts
```

Expected: retry uses diagnostic context and existing cancellation behavior
remains intact.

### Task 5: Persisted Error Parsing

**Files:**

- Modify: `src/server/db/repositories.ts`
- Test: `tests/server/translation/translation-repositories.test.ts`

- [x] Allow optional `diagnostics` in `TranslationPersistedError` parsing.
- [x] Reject malformed diagnostics that are not arrays of safe objects.
- [x] Add a repository round-trip test for a chunk error with diagnostics.
- [x] Run:

```bash
bun run test tests/server/translation/translation-repositories.test.ts
```

Expected: persisted diagnostics round-trip without changing legacy error
records.

### Task 6: Contract Documentation Cleanup

**Files:**

- Modify when needed:
  - `docs/workflows/task-19-codex-translation/09-chunk-validation-and-retry-logic.md`
  - `docs/workflows/task-19-codex-translation/contracts/06-codex-prompt-and-validation.md`
  - `docs/workflows/task-19-codex-translation/15-error-handling-and-cancellation.md`

- [x] Document that validation diagnostics are safe metadata, not raw model
      output.
- [x] Document that retry prompts include previous validation failure summaries.
- [x] Document that no new database table or raw attempt log is introduced.
- [x] Run:

```bash
git diff --check
```

Expected: no whitespace errors.

## Verification

Focused verification:

```bash
bun run test tests/server/translation/prompt.test.ts
bun run test tests/server/translation/structure-fingerprint.test.ts
bun run test tests/server/translation/runner.test.ts
bun run test tests/server/translation/translation-repositories.test.ts
```

Broader verification:

```bash
bun run typecheck
bun run test
bun run verify
git diff --check
```

Current broader verification note: focused translation tests, `bun run
typecheck`, `bun run build`, and `git diff --check` passed in this branch. When
run outside the sandbox, full `bun run test` reached 102 passing test files and
failed only `tests/scripts/runtime-command.test.ts` because the current worktree
contains an unrelated `package.json` host script drift from the expected runtime
command contract. `bun run verify` stops at the same test failure. Do not treat
this workflow as ready for handoff until the runtime host contract is restored
or explicitly accepted out of scope.

Live verification when Codex app-server and ChatGPT auth are available:

1. Start Codex app-server:

```bash
codex app-server --listen unix://
```

2. Start TRAUMA with the app-server endpoint:

```bash
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:// bun run dev
```

3. Retry `Amp Owner's Manual` translation or a synthetic imported memory with
   the same code-heavy structure.
4. Confirm new failed attempts, if any, persist diagnostics in
   `translation_chunks.error`.
5. Confirm successful retries persist only final translated `CONTENT.md` plus
   normal translation metadata, not raw invalid model output.

Live verification is a confidence check, not a substitute for deterministic
fixtures and unit/integration tests.

## Acceptance Criteria

- Schema-valid but semantically invalid output still fails closed.
- Validation failures include safe structured diagnostics.
- Retry prompts include the previous validation failure summary.
- Retry prompts do not include raw invalid model output.
- Existing user-facing error behavior remains compatible.
- Existing persisted error records remain readable.
- No new migration is required.
- No raw source chunks, prompts, model responses, app-server endpoints, auth
  state, tokens, or completed translated article bodies are persisted.
- Focused translation tests, typecheck, full unit tests, and `bun run verify`
  pass before handoff.
