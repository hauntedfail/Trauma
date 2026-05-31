# Task 19V.02: Translation Projection Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate durable projection spans while committing translated `CONTENT.md`.

**Architecture:** Translation validation already reassembles Markdown locally from source segments. Extend that path to return segment-level source and translated ranges, then rebase chunk-local ranges during final stitching and persist current projection spans before purging temporary chunk data.

**Tech Stack:** TypeScript, Vitest, Task 19U segment manifest, existing translation runner/chunker/stitching modules, projection repository from Task 19V.01.

---

## Role

Translation runtime owner.

This worker must not change reader rendering or Flashback/Moment APIs. It owns alignment generation and persistence at translation commit time.

## Files

- Modify: `src/server/translation/types.ts`
- Modify: `src/server/translation/translation-segments.ts`
- Modify: `src/server/translation/chunker.ts`
- Modify: `src/server/translation/prompt.ts`
- Modify: `src/server/translation/runner.ts`
- Modify: `src/server/translation/stitching.ts`
- Modify: `src/server/translation/projection-map.ts`
- Test: `tests/server/translation/translation-segments.test.ts`
- Test: `tests/server/translation/prompt.test.ts`
- Test: `tests/server/translation/chunker.test.ts`
- Test: `tests/server/translation/runner.test.ts`
- Test: `tests/server/translation/stitching.test.ts`

## Contract Changes

Keep `TranslationTextSegment.sourceStart` and `sourceEnd` as chunk-local Markdown offsets for deterministic splicing. Add document-level and reader-level offsets:

```ts
export interface TranslationTextSegment {
  blockId: string;
  id: string;
  sourceStart: number;
  sourceEnd: number;
  sourceDocumentStart: number;
  sourceDocumentEnd: number;
  sourceReaderStart: number;
  sourceReaderEnd: number;
  text: string;
}
```

Add a validated chunk result:

```ts
export interface ValidatedCodexChunkOutput extends RawCodexChunkOutput {
  translated_markdown: string;
  projectionSpans: TranslationChunkProjectionSpan[];
}
```

Chunk projection spans are temporary and use translated chunk-local offsets until final stitch:

```ts
export interface TranslationChunkProjectionSpan {
  segmentId: string;
  blockId: string;
  sourceDocumentStart: number;
  sourceDocumentEnd: number;
  sourceReaderStart: number;
  sourceReaderEnd: number;
  translatedChunkStart: number;
  translatedChunkEnd: number;
  translatedReaderStart: number;
  translatedReaderEnd: number;
}
```

## Alignment Granularity

Before extracting segments, split prose text node ranges into sentence-like spans:

```ts
const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "sentence" })
  : undefined;
```

Fallback split pattern is only:

```ts
/[^.!?。！？]+(?:[.!?。！？]+["')\]]*)?\s*/gu
```

Do not add language-specific full Markdown parsing here. Sentence splitting only applies inside mdast `text` nodes that are already known to be translatable.

## Task Steps

- [ ] **Step 1: Write segment range tests**

Add assertions that a paragraph with two English sentences creates two segments and each segment has source document and reader offsets:

```ts
expect(manifest.segments.map((segment) => segment.text)).toEqual([
  "Top 5 repos defining it, the academic case for why, and who says it's wrong.",
  "Keep the second sentence separate.",
]);
expect(manifest.segments[0]).toMatchObject({
  sourceReaderStart: 0,
  sourceReaderEnd: 75,
});
```

- [ ] **Step 2: Write chunk projection tests**

Add a runner or prompt test where fake Codex returns:

```json
{
  "chunk_index": 0,
  "segments": [
    {
      "id": "s000001",
      "translated_text": "それを定義するトップ5リポジトリ、なぜそうなるかの学術的根拠、そしてそれが誤りだとする立場。"
    }
  ],
  "warnings": []
}
```

Assert the validated output contains one `projectionSpans` entry with non-null source and translated reader ranges.

- [ ] **Step 3: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-segments.test.ts tests/server/translation/prompt.test.ts tests/server/translation/chunker.test.ts tests/server/translation/runner.test.ts tests/server/translation/stitching.test.ts
```

Expected: FAIL because sentence-level segments and projection spans do not exist.

- [ ] **Step 4: Export reader projection primitives**

Extract reusable reader projection from `src/server/store/flashback-markers.ts` without changing existing behavior:

```ts
export interface ReaderTextProjection {
  text: string;
  sourceOffsets: number[];
  sourceEndOffsets: number[];
  protectedOffsets: boolean[];
}

export function projectMarkdownToReaderText(markdown: string): ReaderTextProjection;
```

Existing Flashback marker tests must continue passing.

- [ ] **Step 5: Add document offsets to blocks and chunks**

Add source document offsets to `TranslationBlock` and compute them in `parseMarkdownTranslationBlocks()`. In `createTranslationChunks()`, pass the first block's document offset into `createTranslationSegmentManifest()` so segment document offsets are stable across chunks.

- [ ] **Step 6: Return projection spans from validation**

In `validateCodexChunkOutput()`, after reassembly:

- record translated chunk-local Markdown start/end for each replacement,
- project source and translated Markdown into reader text,
- map Markdown ranges to reader ranges,
- return `projectionSpans` on the validated output.

- [ ] **Step 7: Persist projections at final commit**

In `commitTranslatedContent()`:

- stitch translated chunks in order,
- rebase each chunk projection span to translated document offsets,
- compute final `outputHash`,
- replace projection rows for the job,
- write `TRANSLATION_MAP.json`,
- enqueue backup with both translated `CONTENT.md` and `TRANSLATION_MAP.json`,
- purge temporary chunk Markdown and `translation_chunks.projection_spans_json`
  after successful commit.

- [ ] **Step 8: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-segments.test.ts tests/server/translation/prompt.test.ts tests/server/translation/chunker.test.ts tests/server/translation/runner.test.ts tests/server/translation/stitching.test.ts tests/server/translation/translation-repositories.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Downstream reader and API workers can assume every current translation has zero or more projection spans keyed by the exact source and output hashes. Old translations without projection spans are unsupported for cross-variant annotation and must fail closed.
