# Testing And Verification Rules

## Tests And Verification

- MUST include tests with behavior changes.
- MUST cover storage, importer, markdown, flashback, backup, routing, and reader
  changes with either focused tests or Playwright coverage.
- MUST run `bun run typecheck` for TypeScript-facing changes.
- MUST run relevant verification before handoff and record exact commands and
  outcomes.
- MUST NOT weaken or delete tests to make a change pass unless the test is
  wrong and the PR explains the correction.
- MUST add or identify regression coverage, static checks, or tool
  configuration for each accepted review finding that exposed a reproducible
  bug, invariant gap, parsing edge case, or bad practice.
- MUST NOT use a prose-only docs update as the durable fix for a
  machine-checkable review finding.
- MUST use thread-aware review inspection for PR follow-up and re-sweep after
  pushing fixes.
- SHOULD write deterministic tests with local fixtures, especially for
  extraction and markdown rendering.
- SHOULD prefer focused tests for pure transforms and repositories, then E2E for
  user workflows.
