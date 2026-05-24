# Brilliant Markdown chunking contract

## Parser-backed chunking algorithm

1. Parse frontmatter separately. Frontmatter is metadata, not a translatable body block.
   Preserve the exact raw frontmatter bytes/text so stitching can prepend it unchanged to translated output when the source file had frontmatter.
2. Parse Markdown with the unified/remark/mdast parser stack for segment extraction and structural preservation. The implementation must not attempt to cover the Markdown dialect through ad hoc regex scanning. Line-oriented fallback logic may exist only for controlled diagnostics or migration compatibility.
3. Create translatable text segments from mdast `text` nodes with stable source offsets.
4. Exclude code, inline code, math, HTML, definitions, footnote identifiers, link/image destinations, image metadata, autolink URL text, and frontmatter from translatable segments.
5. Use legacy block grouping only as a chunk boundary compatibility layer:
   - Treat fenced code blocks as one `code_fence` block from opening fence to closing fence.
   - Treat `$$` math blocks as one `math_block` block.
   - Treat contiguous HTML block lines as one `html_block` when they start with block-level tags or comments.
   - Treat ATX headings as `heading` blocks and update `sectionPath`.
   - Treat contiguous table lines as one `table` block.
   - Treat contiguous list lines, including indented continuation lines, as one `list` block.
   - Treat contiguous blockquote lines as one `blockquote` block.
   - Treat Markdown image lines, image-in-link lines, or figure HTML as `image_figure` blocks.
   - Treat likely caption lines immediately following image/figure as `caption` blocks.
   - Treat footnote definitions as `footnote` blocks.
   - Treat bibliography/reference entries under references-like headings as `bibliography_entry` blocks.
   - Treat other prose paragraphs containing inline code as `inline_code_paragraph`.
   - Treat other prose paragraphs as `paragraph`.
   - Use `unknown_raw` only when the scanner cannot classify without risking structural damage.

## Block id rule

```text
b000001, b000002, b000003, ... in source order after frontmatter removal
```

## Segment id rule

```text
s000001, s000002, s000003, ... in source order within each chunk
```

Segment ids are prompt-local. They are deterministic for the chunk source
Markdown and are not stored as durable database state.

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
