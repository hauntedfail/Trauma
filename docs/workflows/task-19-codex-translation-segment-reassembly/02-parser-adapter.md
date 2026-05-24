# Task 19U.02: Parser Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add the parser adapter that exposes frontmatter splitting, parsed mdast, and source-offset diagnostics for translation subtasks.

**Architecture:** The adapter wraps unified/remark setup behind a small TRAUMA-owned module. It keeps raw frontmatter out of Markdown parsing so final output can preserve frontmatter exactly.

**Tech Stack:** TypeScript, Vitest, `unified`, `remark-parse`, `remark-gfm`, `remark-math`, mdast `Root`.

---

## Role

Parser adapter owner.

This worker must not implement segment extraction, validation fingerprints, prompt changes, or runner changes.

## Files

- Create: `src/server/translation/markdown-parser.ts`
- Create: `tests/server/translation/markdown-parser.test.ts`

## Task Steps

- [x] **Step 1: Write parser adapter tests**

Create `tests/server/translation/markdown-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  parseTranslationMarkdownAst,
  splitMarkdownFrontmatter,
} from "../../../src/server/translation/markdown-parser";

describe("translation Markdown parser adapter", () => {
  it("preserves raw frontmatter separately from the Markdown body", () => {
    const parsed = splitMarkdownFrontmatter("---\nid: memory\n---\n# Title\n");

    expect(parsed.frontmatter).toBe("---\nid: memory\n---\n");
    expect(parsed.bodyMarkdown).toBe("# Title\n");
    expect(parsed.bodyOffset).toBe("---\nid: memory\n---\n".length);
  });

  it("parses GFM tables, footnotes, math, and indented code with positions", () => {
    const parsed = parseTranslationMarkdownAst([
      "# Title",
      "",
      "Paragraph with $x+y$ and [docs](https://example.com).",
      "",
      "    const value = 1;",
      "",
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "",
      "[^1]: Footnote text.",
      "",
    ].join("\n"));

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.tree.type).toBe("root");
    expect(parsed.bodyMarkdown).toContain("| A | B |");
    expect(parsed.tree.children.some((node) => node.type === "table")).toBe(true);
    expect(parsed.tree.children.some((node) => node.type === "code")).toBe(true);
    expect(JSON.stringify(parsed.tree)).toContain("\"position\"");
  });
});
```

- [x] **Step 2: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/markdown-parser.test.ts
```

Expected:

- FAIL because `src/server/translation/markdown-parser.ts` does not exist.

- [x] **Step 3: Implement parser adapter**

Create `src/server/translation/markdown-parser.ts`:

```ts
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface ParsedTranslationMarkdown {
  bodyMarkdown: string;
  bodyOffset: number;
  diagnostics: string[];
  frontmatter: string;
  tree: Root;
}

export function splitMarkdownFrontmatter(sourceMarkdown: string): {
  bodyMarkdown: string;
  bodyOffset: number;
  frontmatter: string;
} {
  const opening = /^---(?:\r?\n)/.exec(sourceMarkdown);
  if (opening === null) {
    return { bodyMarkdown: sourceMarkdown, bodyOffset: 0, frontmatter: "" };
  }

  const afterOpening = sourceMarkdown.slice(opening[0].length);
  const closing = /\r?\n---(?:\r?\n|$)/.exec(afterOpening);
  if (closing === null || closing.index === undefined) {
    return { bodyMarkdown: sourceMarkdown, bodyOffset: 0, frontmatter: "" };
  }

  const end = opening[0].length + closing.index + closing[0].length;
  return {
    bodyMarkdown: sourceMarkdown.slice(end),
    bodyOffset: end,
    frontmatter: sourceMarkdown.slice(0, end),
  };
}

export function parseTranslationMarkdownAst(sourceMarkdown: string): ParsedTranslationMarkdown {
  const split = splitMarkdownFrontmatter(sourceMarkdown);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);
  const tree = processor.parse(split.bodyMarkdown) as Root;

  return {
    bodyMarkdown: split.bodyMarkdown,
    bodyOffset: split.bodyOffset,
    diagnostics: [],
    frontmatter: split.frontmatter,
    tree,
  };
}
```

- [x] **Step 4: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/markdown-parser.test.ts
mise exec -- bun run typecheck
```

Expected:

- Parser adapter tests pass.
- Typecheck passes.

## Handoff

Downstream workers can import `parseTranslationMarkdownAst()` and `splitMarkdownFrontmatter()`. Segment extraction and fingerprint validation must use this adapter rather than constructing separate remark processors.
