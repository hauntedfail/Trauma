# Task 19U.06: Chunker Runner And Stitching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Thread segment manifests through chunking, Codex invocation, temporary persistence, and final stitching.

**Architecture:** Chunking still follows source order, but chunks carry segment metadata. Runner submits segment prompts, validates segment output, stores reassembled chunk Markdown in the existing temporary chunk path, and final stitching commits normal translated Markdown content.

**Tech Stack:** TypeScript, Vitest, existing translation repositories, segment prompt helpers from Task 19U.05.

---

## Role

Runtime integration owner.

This worker must not change parser library selection or policy docs. It owns the production translation flow after prompt helpers exist.

## Files

- Modify: `src/server/translation/chunker.ts`
- Modify: `src/server/translation/runner.ts`
- Modify: `src/server/translation/stitching.ts`
- Modify: `src/server/translation/types.ts`
- Modify: `tests/server/translation/chunker.test.ts`
- Modify: `tests/server/translation/runner.test.ts`

## Task Steps

- [x] **Step 1: Write chunker and runner tests**

Add chunker assertions:

```ts
expect(chunks[0]?.segments.map((segment) => segment.id)).toEqual([
  "s000001",
  "s000002",
]);
```

Add runner fake-client assertions:

```ts
expect(observedPrompt).toContain("\"segments\"");
expect(observedPrompt).not.toContain("\"translated_markdown\"");
```

Add committed output assertions:

```ts
expect(committedMarkdown).toContain("[ドキュメント](https://example.com/docs)");
expect(committedMarkdown).toContain("`inlineCode`");
```

- [x] **Step 2: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/chunker.test.ts tests/server/translation/runner.test.ts
```

Expected:

- FAIL because chunks do not carry segment metadata and runner still expects block Markdown output.

- [x] **Step 3: Extend chunk types**

Modify `src/server/translation/types.ts`:

```ts
export interface TranslationChunk {
  segments: TranslationTextSegment[];
}
```

Keep existing `TranslationChunk` fields. Add `segments` without removing persisted job/chunk status types.

- [x] **Step 4: Update chunk creation**

Modify `src/server/translation/chunker.ts`:

- Create or receive the parser-backed segment manifest.
- Include all segments whose source ranges belong to the chunk's block ids.
- Preserve segment order by source offset.
- Keep chunk size limits based on source Markdown, not translated output.

- [x] **Step 5: Update runner and stitching**

Modify `src/server/translation/runner.ts`:

- Build segment prompts from `chunk.segments`.
- Pass the segment schema to Codex app-server.
- Validate returned segment output through prompt-domain helpers.
- Persist reassembled chunk Markdown in the existing temporary chunk storage path.
- Continue retrying on `TranslationOutputValidationError`.

Modify `src/server/translation/stitching.ts`:

- Preserve raw frontmatter exactly.
- Stitch reassembled chunk Markdown in source order.
- Continue writing the final translated `CONTENT.md` variant through existing storage boundaries.

- [x] **Step 6: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/chunker.test.ts tests/server/translation/runner.test.ts
mise exec -- bun run typecheck
```

Expected:

- Chunker and runner tests pass.
- Typecheck passes.

## Handoff

Docs and E2E workers can assume the primary runtime path uses segment prompts and deterministic reassembly. Existing temporary SQLite `translated_markdown` storage may still hold reassembled chunk Markdown until purge.
