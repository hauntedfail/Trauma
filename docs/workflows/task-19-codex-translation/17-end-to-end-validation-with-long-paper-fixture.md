# 19.17 End-to-end validation with long paper fixture

## Goal

Validate that the full translation pipeline completes a long academic-style document without omission.

## Scope

Run an end-to-end translation flow using a long paper fixture and fake app-server output by default, with optional live Codex app-server smoke when credentials and usage limits permit.

## Inputs

- 19.16 long-paper fixture
- Completed implementation from 19.2 through 19.15
- Optional local Codex app-server with ChatGPT sign-in

## Outputs

- E2E verification script or test case for long-document translation.
- Verification notes for deterministic fake-client run.
- Optional manual smoke notes for live Codex app-server run.

## Dependencies

- All implementation subtasks 19.2 through 19.16.

## Acceptance criteria

- The long paper fixture is chunked into multiple chunks by block groups, not raw character slicing.
- Every source block id appears exactly once in validated translated output.
- Chunk retry can recover from one injected validation failure.
- Final stitched Markdown passes full-document validation.
- Final output is committed to `memory/<memory_id>/<lang_code>/CONTENT.md` atomically.
- Source `memory/<memory_id>/CONTENT.md` remains unchanged.
- SQLite job metadata records completion, output path, output hash, and source hash.
- Completed chunk bodies are purged from SQLite after commit.
- Reader can render the translated variant.
- The frontend can show progress from job start through completion.

## Parallelization notes

This is the final validation subtask and should not start until core implementation is complete. A worker can prepare fixture data earlier, but the E2E run depends on the integrated pipeline.

## Implementation risks

- A short article smoke test is insufficient because it will not exercise chunking, retry, and stitching.
- Live Codex app-server runs may be blocked by auth, usage, or network state; deterministic fake-client E2E must be the baseline.
- The final validation must inspect SQLite cleanup as well as the committed file.
