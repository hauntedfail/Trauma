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

## Retry contract

- Retry only the failed chunk.
- Increment `retry_count` before each retry.
- Include structured validation failures in the retry prompt.
- Use `maxRetries` from chunk config.
- After retry exhaustion, mark chunk and job failed.

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
- media-only block may remain empty when explicitly allowed
- retry prompt includes validation errors and original block ids
- retry count increments
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
