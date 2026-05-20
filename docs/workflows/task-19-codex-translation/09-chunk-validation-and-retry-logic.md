# 19.9 Chunk validation and retry logic

## Goal

Validate final chunk output and retry only failed chunks. This subtask does not stitch the full document or write final files.

## Files likely owned

- `src/server/translation/validator.ts`
- `tests/server/translation/validator.test.ts`

## Contract references

- `contracts/05-markdown-chunking.md`
- `contracts/06-codex-prompt-and-validation.md`

## Instruction alignment

Scope: final chunk output validation and chunk-level retry decisions.

Inputs: expected chunk manifest, protected spans, Codex final item output, retry count, and chunk config thresholds.

Outputs: structured validation errors, retry prompt context, chunk status updates, and retry exhaustion behaviour.

Dependencies: 19.4 provides expected blocks; 19.8 defines output schema; 19.3 owns job/chunk state transitions.

Parallelization notes: can run beside prompt work after schema names are frozen; do not stitch full documents here.

Implementation risks: retrying the whole document or accepting missing block ids violates completeness guarantees.

## Validation contract

Validate in this order:

1. JSON parses and matches output schema.
2. `chunk_index` equals requested chunk index.
3. Output block ids exactly equal input block ids in the same order.
4. No duplicate block ids.
5. `translated_markdown` is non-empty unless the source block is non-translatable media-only content.
6. Protected spans are preserved per block.
7. Code fence delimiter count is unchanged.
8. Math delimiters are unchanged.
9. HTML tag names and balance are unchanged for HTML blocks.
10. Citation markers and footnote markers are preserved.
11. URLs and Markdown link destinations are preserved.
12. Omission markers are rejected when used as omission markers.
13. Prose length ratio stays within configured thresholds.

Error code boundary:

- `invalid_final_output` means Codex final output cannot be parsed as JSON or
  does not match the required `CodexChunkOutput` schema after all configured
  output-mode fallbacks are exhausted.
- `validation_failed` means the output is schema-valid `CodexChunkOutput` JSON
  but semantic validation fails.
- Store chunk validation failures in `translation_chunks.error` as structured
  `TranslationPersistedError` JSON.

## Retry contract

- Retry only the failed chunk.
- Start a fresh ephemeral Codex thread for each retry attempt.
- Do not reuse the failed attempt's Codex thread because the thread history may contain invalid output or failed repair context.
- Increment `retry_count` before each retry.
- Include structured validation failures in the retry prompt.
- Retry prompts include only Reader-generated structured validation failure summaries and original block ids, not raw invalid model output beyond the minimal safe excerpts needed for validation diagnostics.
- Use `maxRetries` from chunk config.
- `maxRetries` is the number of retry attempts after the initial attempt, so total attempts are `1 + maxRetries`.
- The initial attempt starts with `retry_count = 0`; increment `retry_count` before each retry attempt starts.
- After retry exhaustion, mark chunk and job failed.
- `outputSchema` rejection or fallback to prompt-only JSON mode is not a validation retry and does not change `retry_count`.
- If `outputSchema` is rejected after a thread has been created, the app-server client discards that thread and starts a fresh prompt-only thread for the same chunk attempt.
- Retry logic starts only after Codex returns final output for the selected output mode and that output fails parsing/schema/semantic validation.

## Failure examples to test

- missing block id
- duplicate block id
- reordered block ids
- lost URL
- lost citation marker
- lost footnote marker
- corrupted code fence
- corrupted math delimiter
- corrupted HTML tag
- omission marker such as `summary`, `omitted`, or `省略`
- prose length ratio outside threshold

## Tests

Cover:

- valid chunk passes
- each failure example returns a structured validation error
- JSON parse/schema failures use `invalid_final_output`
- semantic validation failures use `validation_failed`
- chunk error persistence uses structured `TranslationPersistedError` JSON
- media-only block may remain empty when explicitly allowed
- retry prompt includes validation errors and original block ids
- retry starts a fresh ephemeral Codex thread for each attempt
- retry prompt does not depend on prior failed thread history
- output-mode fallback does not increment retry count
- output-mode fallback starts a fresh thread when the rejected mode already created one
- retry count increments
- `maxRetries: 3` allows four total attempts: one initial attempt and three retry attempts
- retry exhaustion marks failed

## Verification

```sh
mise exec -- bun run test tests/server/translation/validator.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Validation is deterministic.
- Retry is chunk-level, not full-document.
- Validator preserves the structures needed for academic papers.
