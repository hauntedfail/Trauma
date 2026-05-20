# 19.16 Test plan and fixtures

## Goal

Create deterministic tests and fixtures for the Task 19 translation pipeline without requiring live Codex for most coverage.

## Scope

Add unit, integration, and component tests using fake app-server clients, deterministic chunk outputs, and Markdown fixtures. This subtask defines test assets and expected behavior across storage, chunking, streaming, validation, atomic commit, cleanup, and reader rendering.

## Inputs

- Interfaces from 19.2 through 19.15
- Existing test conventions
- Existing memory fixture patterns

## Outputs

- Markdown fixtures covering ordinary articles, long academic paper structure, code fences, math, citations, footnotes, tables, HTML blocks, images, captions, and bibliography entries.
- Fake Codex app-server client for deterministic streaming and final outputs.
- Test coverage map tied to acceptance criteria.

## Dependencies

- Core interfaces from 19.2 through 19.10 must be stable before broad fixture implementation.

## Acceptance criteria

- Tests cover BCP 47 `lang_code` path resolution and path traversal rejection.
- Tests cover source hash and stale translation detection.
- Tests cover deterministic block ids and chunk grouping.
- Tests cover prompt schema construction without shell interpolation or credential exposure.
- Tests cover partial delta streaming as non-authoritative progress.
- Tests cover chunk validation success and failure.
- Tests cover chunk-level retry.
- Tests cover final stitching order.
- Tests cover atomic writer behavior and existing translation preservation on failure.
- Tests cover purge of `translated_markdown` after commit.
- Tests cover reader source rendering and translated variant rendering.
- Tests cover auth-required and setup-required UI states.
- Live Codex app-server smoke is separated from deterministic CI tests.

## Parallelization notes

Fixture creation can begin once 19.4 block types are known. Full tests should wait for each owning interface to stabilize.

## Implementation risks

- Live Codex-dependent tests will be flaky and should be smoke-only unless the environment explicitly provides app-server credentials.
- Fixtures must include enough hostile/untrusted content to test prompt-injection defenses.
- Tests must assert cleanup, not only successful file output.
