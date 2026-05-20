# 19.9 Chunk validation and retry logic

## Goal

Validate completed chunk outputs and retry failed chunks without retrying the full document.

## Scope

Implement JSON parsing, schema validation, structural validation, protected-span checks, truncation heuristics, configurable length checks, retry prompts, and retry event emission.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- 19.4 block manifest and protected spans
- 19.8 output schema
- 19.3 chunk state machine

## Outputs

- Create: `src/server/translation/validator.ts`
- Test: `tests/server/translation/validator.test.ts`

## Dependencies

- 19.4 and 19.8 are required.
- 19.3 is required for retry counters.

## Concrete validation order

Use the 13-step validation algorithm in `00-execution-contracts.md` exactly. Do not add fuzzy success modes unless a test documents why they are safe.

Retry policy:

```ts
maxRetries: 3
retryPromptIncludes: validationErrors, chunkMetadata, originalBlockIds, originalSourceChunk
```

Failure examples that must be tested:

- Missing block id
- Duplicate block id
- Reordered block ids
- Lost URL
- Lost citation marker
- Lost footnote marker
- Corrupted code fence
- Corrupted math delimiter
- Omission marker such as `summary` or `省略`
- Length ratio outside threshold for prose chunk

## Acceptance criteria

- Validator returns structured error codes, not only strings.
- Validation failure retries only the failed chunk.
- Retry increments `retry_count` before the retry run.
- Exhausted retries mark chunk and job failed.
- Protected non-prose blocks are exempted from prose length ratio checks.
- Tests cover both valid translation and every failure example above.

## Parallelization notes

Can run after 19.4 and 19.8. It can run beside 19.10 once the validated-output interface is stable.

## Implementation risks

- Over-strict ratios can reject valid translations.
- Under-strict validation can allow omissions that become invisible after stitching.
- Retry prompts must not drop original protected-span requirements.
