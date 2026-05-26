# Task 19U.08: End-To-End Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Verify the segment translation pipeline end to end with long article and academic-paper fixtures.

**Architecture:** This subtask proves the complete pipeline preserves Markdown syntax while translating prose through segment output. It does not introduce new architecture.

**Tech Stack:** Vitest, Bun, parser fixtures, fake Codex client, translation repositories.

---

## Role

End-to-end verification owner.

This worker must not change library selection or runtime architecture unless a failing E2E test exposes a concrete implementation bug. Any such bug fix must remain scoped to the failing domain.

## Files

- Create: `tests/fixtures/translation/academic-paper-segments.md`
- Modify: `tests/server/translation/runner.test.ts`
- Modify: `tests/server/translation/api-routes.test.ts`
- Modify: `tests/server/translation/translation-repositories.test.ts`

## Task Steps

- [x] **Step 1: Add academic fixture**

Create `tests/fixtures/translation/academic-paper-segments.md`:

````md
---
id: academic-segments
title: Segment Translation Fixture
---

# Segment Translation for Reader Archives

## Abstract

We evaluate a local-first reader archive that translates article prose while preserving Markdown syntax [Smith et al., 2024].

## Method

The system keeps inline math such as $p(y|x)$ unchanged and translates only surrounding prose.

$$
\operatorname*{argmax}_y p(y|x)
$$

| Component | Requirement |
| --- | --- |
| Parser | Preserve structure |
| Translator | Return segments |

> Block quotes remain block quotes even when their text changes.

Use `inlineCode` and fenced code without translation:

```ts
const preserved = "code";
```

See [the reference implementation](https://example.com/reference "Reference title").

[^1]: Footnotes may contain prose and [links](https://example.com/footnote).

## References

Smith, A. and Lee, K. (2024). Segment translation for structured documents.
````

- [x] **Step 2: Add fake Codex segment translator**

In runner tests, adapt the fake client to parse prompt segment metadata and return one entry per segment id:

```json
{
  "chunk_index": 0,
  "segments": [
    { "id": "s000001", "translated_text": "JA:s000001" },
    { "id": "s000002", "translated_text": "JA:s000002" }
  ],
  "warnings": []
}
```

The fake translator must not return Markdown syntax.

- [x] **Step 3: Assert committed translated Markdown preserves syntax**

Add assertions that committed output:

- Contains original link destinations.
- Contains original code fence content.
- Contains original inline code.
- Contains original math.
- Has the same table row and column counts.
- Preserves frontmatter exactly.
- Contains translated prose markers from fake segment output.

- [x] **Step 4: Run focused verification**

Run:

```sh
mise exec -- bun run test tests/server/translation/markdown-parser.test.ts tests/server/translation/translation-segments.test.ts tests/server/translation/structure-fingerprint.test.ts tests/server/translation/prompt.test.ts tests/server/translation/chunker.test.ts tests/server/translation/runner.test.ts tests/server/translation/api-routes.test.ts tests/server/translation/translation-repositories.test.ts
mise exec -- bun run typecheck
git diff --check
```

Expected:

- All focused translation tests pass.
- Typecheck passes.
- No whitespace errors.

- [x] **Step 5: Run full verification**

Run:

```sh
mise exec -- bun run verify
```

Expected:

- Full verify passes.
- If unrelated backup/delete timeout flakes recur, re-run the failing test files individually and record the exact unrelated failure in the handoff.

## Handoff

This subtask closes Task 19U only after focused translation tests, typecheck, whitespace checks, and full verification have evidence. Do not claim Task 19U complete from partial focused tests alone.
