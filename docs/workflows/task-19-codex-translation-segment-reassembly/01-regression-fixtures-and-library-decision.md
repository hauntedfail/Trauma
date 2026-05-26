# Task 19U.01: Regression Fixtures And Library Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Lock the current Markdown translation regression surface and install the parser stack that prevents further full-scratch parser growth.

**Architecture:** This subtask owns evidence and dependency selection only. It captures known scratch-parser weak points as tests/fixtures, then adds the unified/remark/mdast parser dependencies that later subtasks consume.

**Tech Stack:** Bun, Vitest, `unified`, `remark-parse`, `remark-gfm`, `remark-math`, `unist-util-visit-parents`, `@types/mdast`, `@types/unist`.

---

## Role

Regression and library-decision owner.

This worker must not implement segment extraction, prompt schema, runner integration, or docs cleanup. Its output is a fixture matrix, characterization tests, and dependency updates.

## Files

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tests/server/translation/markdown-blocks.test.ts`
- Modify: `tests/server/translation/prompt.test.ts`
- Create: `tests/fixtures/translation/markdown-segment-matrix.md`

## Task Steps

- [x] **Step 1: Add the Markdown segment matrix fixture**

Create `tests/fixtures/translation/markdown-segment-matrix.md`:

````md
---
id: segment-matrix
title: Segment Matrix
---

# ATX Heading

Setext Heading
--------------

Paragraph with `inlineCode`, $e^{i\pi}+1=0$, \(x+y\), [the docs](https://example.com/docs "Docs title"), and [Smith et al., 2020].

    const value = 1;
    console.log(value);

`````md
```ts
const nested = true;
```
`````

| Term | Meaning |
| --- | --- |
| API | Application interface |

> Quoted text with **strong words**.

- First item
  continuation text
- Second item

![Diagram alt text](https://example.com/diagram.png)

[^1]: Footnote text with [source](https://example.com/source).

[ref-docs]: https://example.com/ref "Reference title"
Read [reference docs][ref-docs].
````

- [x] **Step 2: Add characterization tests for known gaps**

In `tests/server/translation/markdown-blocks.test.ts`, add these explicit pending tests:

```ts
it.todo("does not translate inline math spans");
it.todo("treats indented code blocks as non-translatable code");
it.todo("preserves setext heading structure");
it.todo("preserves Markdown link titles and reference labels");
it.todo("does not protect ordinary prose as shell commands");
```

- [x] **Step 3: Add parser dependencies**

Run:

```sh
mise exec -- bun add unified remark-parse remark-gfm remark-math unist-util-visit-parents
mise exec -- bun add -d @types/mdast @types/unist
```

Expected:

- `package.json` and `bun.lock` are updated.
- `remark-stringify`, `mdast-util-to-markdown`, and `tree-sitter-markdown` are not added.
- `remark-frontmatter` is not added unless a later task intentionally stops using raw frontmatter splitting.

- [x] **Step 4: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/markdown-blocks.test.ts tests/server/translation/prompt.test.ts
mise exec -- bun run typecheck
```

Expected:

- Existing tests pass.
- New `it.todo` entries are reported as todo/pending.
- Typecheck passes.

## Handoff

Downstream workers can assume parser dependencies exist and the fixture matrix is available. They must not reinterpret the library decision without updating this subtask and the parent orchestration index.
