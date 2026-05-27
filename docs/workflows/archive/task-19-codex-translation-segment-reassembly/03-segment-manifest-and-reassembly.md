# Task 19U.03: Segment Manifest And Reassembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extract translatable text segments from parsed Markdown and deterministically splice translated text back into original source ranges.

**Architecture:** Codex should never rewrite Markdown syntax. This subtask creates the segment IR and reassembly function that later prompt and runner code use as the only production output path.

**Tech Stack:** TypeScript, Vitest, mdast positions, `unist-util-visit-parents`, parser adapter from Task 19U.02.

---

## Role

Segment IR and source-splicing owner.

This worker must not change the Codex prompt schema or runner. It only creates the manifest and deterministic reassembly primitives.

## Files

- Modify: `src/server/translation/types.ts`
- Create: `src/server/translation/translation-segments.ts`
- Create: `tests/server/translation/translation-segments.test.ts`

## Task Steps

- [x] **Step 1: Write segment extraction and splicing tests**

Create `tests/server/translation/translation-segments.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  applyTranslatedSegments,
  createTranslationSegmentManifest,
} from "../../../src/server/translation/translation-segments";

describe("translation segment manifest", () => {
  it("extracts only translatable text while preserving syntax ranges", () => {
    const manifest = createTranslationSegmentManifest([
      "# Source Title",
      "",
      "Read [the docs](https://example.com/docs \"Docs\") and `inlineCode`.",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
    ].join("\n"));

    expect(manifest.segments.map((segment) => segment.text)).toEqual([
      "Source Title",
      "Read ",
      "the docs",
      " and ",
    ]);
    expect(manifest.segments.some((segment) => segment.text.includes("inlineCode"))).toBe(false);
    expect(manifest.protectedRanges.some((range) => range.kind === "math")).toBe(true);
  });

  it("reassembles translated text into the original Markdown syntax", () => {
    const source = "Read [the docs](https://example.com/docs \"Docs\") and `inlineCode`.\n";
    const manifest = createTranslationSegmentManifest(source);
    const output = applyTranslatedSegments({
      manifest,
      translations: [
        { segmentId: "s000001", translatedText: "読んでください " },
        { segmentId: "s000002", translatedText: "ドキュメント" },
        { segmentId: "s000003", translatedText: " と " },
      ],
    });

    expect(output).toBe("読んでください [ドキュメント](https://example.com/docs \"Docs\") と `inlineCode`.\n");
  });
});
```

- [x] **Step 2: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-segments.test.ts
```

Expected:

- FAIL because `translation-segments.ts` does not exist.

- [x] **Step 3: Add segment types**

Modify `src/server/translation/types.ts`:

```ts
export interface TranslationTextSegment {
  blockId: string;
  id: string;
  sourceEnd: number;
  sourceStart: number;
  text: string;
}

export interface TranslationProtectedRange {
  kind:
    | "code"
    | "inline_code"
    | "math"
    | "html"
    | "link_destination"
    | "link_title"
    | "image_destination"
    | "footnote_label"
    | "table_delimiter"
    | "frontmatter";
  sourceEnd: number;
  sourceStart: number;
  value: string;
}

export interface TranslationSegmentReplacement {
  segmentId: string;
  translatedText: string;
}
```

- [x] **Step 4: Implement manifest and splicing**

Create `src/server/translation/translation-segments.ts` with these exports:

```ts
export interface TranslationSegmentManifest {
  frontmatter: string;
  protectedRanges: TranslationProtectedRange[];
  segments: TranslationTextSegment[];
  sourceMarkdown: string;
}

export function createTranslationSegmentManifest(sourceMarkdown: string): TranslationSegmentManifest;

export function applyTranslatedSegments(input: {
  manifest: TranslationSegmentManifest;
  translations: TranslationSegmentReplacement[];
}): string;
```

Implementation requirements:

- Parse with `parseTranslationMarkdownAst()`.
- Traverse with `unist-util-visit-parents`.
- Create segment ids as `s000001`, `s000002`, then continue in source order.
- Extract `text` nodes under translatable containers.
- Exclude descendants of `code`, `inlineCode`, `math`, `inlineMath`, `html`, `yaml`, and link/image URL/title metadata.
- Allow link labels, emphasis text, heading text, list item text, blockquote text, table cell text, and footnote body text.
- Use mdast `position.start.offset` and `position.end.offset` for `sourceStart` and `sourceEnd`, adjusted by `bodyOffset` when using full-source offsets.
- If a required node does not expose usable offsets, add a narrow `micromark` fallback for that construct and a regression test proving the fallback range.
- Apply replacements in descending `sourceStart` order.
- Throw a `TranslationOutputValidationError` if a segment id is missing, duplicated, unknown, or maps to an empty translated string after trim.

- [x] **Step 5: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-segments.test.ts
mise exec -- bun run typecheck
```

Expected:

- Segment tests pass.
- Typecheck passes.

## Handoff

Downstream prompt and runner workers can call `createTranslationSegmentManifest()` to build prompt input and `applyTranslatedSegments()` to produce reassembled Markdown. They must not ask Codex to return full Markdown for the primary path.
