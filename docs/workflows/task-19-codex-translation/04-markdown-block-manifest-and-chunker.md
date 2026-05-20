# 19.4 Markdown block manifest and chunker

## Goal

Implement deterministic Markdown block parsing and block-group chunking for complete long-document translation.

## Scope

Build the Reader-side block manifest generator, protected-span extractor, section-aware chunker, and chunk metadata builder. Do not call Codex in this subtask.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- Source `memory/<memory_id>/CONTENT.md`
- Existing Markdown/frontmatter parser behavior

## Outputs

- Create: `src/server/translation/markdown-blocks.ts`
- Create: `src/server/translation/chunker.ts`
- Test: `tests/server/translation/markdown-blocks.test.ts`
- Test: `tests/server/translation/chunker.test.ts`
- Fixture: `tests/fixtures/translation/markdown-protected-spans.md`
- Fixture: `tests/fixtures/translation/academic-paper.md`

## Dependencies

- 19.1 contracts.
- 19.3 `TranslationSourceSnapshot` type if source metadata is already centralized.

## Concrete algorithm

Use the line scanner, block id rule, protected span model, and default chunk config in `00-execution-contracts.md`.

Mandatory block examples in tests:

```md
# Heading

Paragraph with `inlineCode` and [a link](https://example.com).

$$
E = mc^2
$$

```ts
const value = "do not translate";
```

| Term | Meaning |
| --- | --- |
| API | Application interface |

[^1]: Footnote text.
```

Expected ids:

```text
b000001 heading
b000002 inline_code_paragraph
b000003 math_block
b000004 code_fence
b000005 table
b000006 footnote
```

## Acceptance criteria

- Same source Markdown always produces the same block ids.
- Frontmatter is excluded from translatable blocks.
- The scanner identifies all block types listed in `TranslationBlockType`.
- Protected spans include inline code, code fences, math, URLs, Markdown link destinations, citations, footnotes, HTML tags, file paths, commands, identifiers, and placeholders where detectable.
- Chunking preserves source order.
- Chunking prefers section boundaries but splits oversized sections by contiguous block groups.
- Chunking never splits inside a block.
- A single oversized block is kept whole and flagged instead of being sliced.
- Chunk metadata includes all fields required by `TranslationChunk`.

## Parallelization notes

Can run in parallel with 19.2 after 19.1. Blocks 19.8, 19.9, 19.10, and long-paper validation.

## Implementation risks

- Raw character slicing will corrupt Markdown and invalidate protected spans.
- Non-deterministic ids break retry and stitching.
- Missing section paths make chunk progress hard to display and debug.
