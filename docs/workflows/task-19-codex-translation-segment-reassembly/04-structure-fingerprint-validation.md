# Task 19U.04: Structure Fingerprint Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Validate that reassembled translated Markdown preserves source Markdown structure and protected syntax.

**Architecture:** Structural validation compares parser-backed fingerprints for source and translated Markdown. It replaces regex protected-span scanning as the primary correctness mechanism.

**Tech Stack:** TypeScript, Vitest, parser adapter from Task 19U.02, `TranslationOutputValidationError`.

---

## Role

Structural validation owner.

This worker must not change prompt construction or runner persistence. It only owns fingerprint creation and comparison.

## Files

- Create: `src/server/translation/structure-fingerprint.ts`
- Create: `tests/server/translation/structure-fingerprint.test.ts`

## Task Steps

- [x] **Step 1: Write fingerprint tests**

Create `tests/server/translation/structure-fingerprint.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  assertMarkdownStructurePreserved,
  createMarkdownStructureFingerprint,
} from "../../../src/server/translation/structure-fingerprint";

describe("translation structure fingerprint", () => {
  it("treats translated prose as equivalent when Markdown syntax is unchanged", () => {
    const source = "Read [docs](https://example.com/docs) and `code`.\n";
    const translated = "読む [ドキュメント](https://example.com/docs) と `code`.\n";

    expect(() => assertMarkdownStructurePreserved({ source, translated })).not.toThrow();
  });

  it("rejects changed link destinations and inline code", () => {
    expect(() =>
      assertMarkdownStructurePreserved({
        source: "Read [docs](https://example.com/docs).\n",
        translated: "読む [docs](https://wrong.example/docs).\n",
      })
    ).toThrow(/link destination/);

    expect(() =>
      assertMarkdownStructurePreserved({
        source: "Use `inlineCode`.\n",
        translated: "Use `translatedCode`.\n",
      })
    ).toThrow(/inline code/);
  });

  it("creates stable fingerprints for table shape and inline math", () => {
    const fingerprint = createMarkdownStructureFingerprint([
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "",
      "$x+y$",
    ].join("\n"));

    expect(fingerprint.entries.some((entry) => entry.kind === "table")).toBe(true);
    expect(fingerprint.entries.some((entry) => entry.kind === "inline_math")).toBe(true);
  });
});
```

- [x] **Step 2: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/structure-fingerprint.test.ts
```

Expected:

- FAIL because `structure-fingerprint.ts` does not exist.

- [x] **Step 3: Implement fingerprint comparison**

Create `src/server/translation/structure-fingerprint.ts` with these exports:

```ts
export interface MarkdownStructureFingerprint {
  entries: MarkdownStructureFingerprintEntry[];
}

export interface MarkdownStructureFingerprintEntry {
  kind:
    | "block"
    | "code"
    | "inline_code"
    | "math"
    | "inline_math"
    | "html"
    | "link_destination"
    | "image_destination"
    | "table"
    | "footnote_definition";
  value: string;
}

export function createMarkdownStructureFingerprint(markdown: string): MarkdownStructureFingerprint;

export function assertMarkdownStructurePreserved(input: {
  source: string;
  translated: string;
}): void;
```

Implementation requirements:

- Parse source and translated Markdown with `parseTranslationMarkdownAst()`.
- Compare ordered block kinds for structural block nodes.
- Compare exact values for code, inline code, math, inline math, HTML, link URLs, image URLs, and footnote identifiers.
- Compare table shape as row count and cell count per row, not translated cell text.
- Throw `TranslationOutputValidationError` with messages that identify the changed structure class.

- [x] **Step 4: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/structure-fingerprint.test.ts
mise exec -- bun run typecheck
```

Expected:

- Fingerprint tests pass.
- Typecheck passes.

## Handoff

Prompt and runner workers can use `assertMarkdownStructurePreserved()` after segment reassembly. Regex protected-span checks may remain as legacy guardrails, but not as the primary validation contract.
