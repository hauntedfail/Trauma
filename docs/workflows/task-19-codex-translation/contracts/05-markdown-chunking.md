# Brilliant Markdown chunking contract

## Block algorithm

1. Parse frontmatter separately. Frontmatter is metadata, not a translatable body block.
   Preserve the exact raw frontmatter bytes/text so stitching can prepend it unchanged to translated output when the source file had frontmatter.
2. Scan Markdown line by line.
3. Treat fenced code blocks as one `code_fence` block from opening fence to closing fence.
4. Treat `$$` math blocks as one `math_block` block.
5. Treat contiguous HTML block lines as one `html_block` when they start with block-level tags or comments.
6. Treat ATX headings as `heading` blocks and update `sectionPath`.
7. Treat contiguous table lines as one `table` block.
8. Treat contiguous list lines, including indented continuation lines, as one `list` block.
9. Treat contiguous blockquote lines as one `blockquote` block.
10. Treat Markdown image lines, image-in-link lines, or figure HTML as `image_figure` blocks.
11. Treat likely caption lines immediately following image/figure as `caption` blocks.
12. Treat footnote definitions as `footnote` blocks.
13. Treat bibliography/reference entries under references-like headings as `bibliography_entry` blocks.
14. Treat other prose paragraphs containing inline code as `inline_code_paragraph`.
15. Treat other prose paragraphs as `paragraph`.
16. Use `unknown_raw` only when the scanner cannot classify without risking structural damage.

## Block id rule

```text
b000001, b000002, b000003, ... in source order after frontmatter removal
```

## Chunking defaults

```ts
export const DEFAULT_TRANSLATION_CHUNK_CONFIG = {
  maxRoughTokens: 2500,
  softRoughTokens: 1800,
  maxBlocks: 80,
  maxRetries: 3,
  minLengthRatio: 0.35,
  maxLengthRatio: 2.8,
} as const;
```

`maxRetries` is the number of retry attempts after the initial attempt. With
`maxRetries: 3`, the runner may make at most four total attempts for one chunk:
one initial attempt plus three retry attempts.

## Chunking rules

- Prefer section boundaries from heading path.
- Group adjacent small sections while under `softRoughTokens`.
- Split oversized sections by contiguous block groups under `maxRoughTokens`.
- Never split inside a block.
- If a single block exceeds `maxRoughTokens`, mark the chunk as oversized and let Codex validation/retry handle context errors.
- Do not slice an oversized block unless a later task defines block-specific splitting.

## Required fixture example

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
