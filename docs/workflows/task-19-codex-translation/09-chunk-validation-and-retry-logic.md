# 19.9 Chunk validation and retry logic

## Goal

Validate completed chunk outputs and retry failed chunks without retrying the full document.

## Scope

Implement chunk result parsing, structural validation, protected-span checks, truncation heuristics, configurable length sanity checks, retry policy, and retry event emission.

## Inputs

- 19.4 block manifest and protected spans
- 19.8 output schema
- 19.3 chunk state machine
- 19.7 event bridge

## Outputs

- Chunk validator module.
- Retry classifier for validation failure, app-server failure, auth failure, usage limit, context overflow, timeout, and stream disconnect.
- Retry event emission for `translation.chunk.failed` and `translation.chunk.retrying`.

## Dependencies

- 19.4 and 19.8 are required.
- 19.3 is required for retry counters and status updates.

## Acceptance criteria

- Output parses as the expected JSON schema.
- All expected block ids are present.
- No unexpected block ids are accepted unless explicitly allowed by frozen contract.
- No duplicate block ids are accepted.
- Block order is preserved.
- Protected spans are preserved.
- Markdown code fence count is preserved.
- HTML tags are not corrupted.
- LaTeX delimiters are preserved.
- Citation markers and footnote markers are preserved.
- Obvious truncation markers such as `...`, `omitted`, `省略`, and `summary` fail validation when they indicate omitted content.
- Translated length ratio is checked against configurable sanity thresholds.
- Validation failure retries only the failed chunk up to the configured retry limit.
- Exhausted retries fail the job with an actionable error.

## Parallelization notes

This can run after 19.4 and 19.8. It can run beside 19.10 if final stitching consumes only the validator result interface.

## Implementation risks

- Over-strict length thresholds can reject valid translations between languages with different density.
- Under-strict validation can allow omissions that are hard to detect after stitching.
- Retrying without preserving the original block manifest can duplicate or reorder blocks.
