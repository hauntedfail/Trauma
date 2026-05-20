# 19.4 Markdown block manifest and chunker

## Goal

Parse source Markdown into deterministic blocks and chunk contiguous block groups so long articles and academic papers can be translated completely.

## Files likely owned

- `src/server/translation/markdown-blocks.ts`
- `src/server/translation/chunker.ts`
- `tests/server/translation/markdown-blocks.test.ts`
- `tests/server/translation/chunker.test.ts`
- `tests/fixtures/translation/markdown-protected-spans.md`
- `tests/fixtures/translation/academic-paper.md`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/05-markdown-chunking.md`

## Instruction alignment

Scope: deterministic block manifest, protected spans, and chunk construction only.

Inputs: source Markdown body, frontmatter parser behaviour, required block types, and chunk config defaults.

Outputs: ordered block ids, block metadata, protected spans, section paths, and contiguous block-group chunks.

Dependencies: 19.1 freezes block id format and 19.3 supplies source snapshots.

Parallelization notes: can run in parallel with Codex client work after shared translation types are frozen.

Implementation risks: slicing raw characters or splitting inside protected structures can corrupt Markdown and make validation unreliable.

## Block manifest contract

Generate blocks with ids in source order:

```text
b000001
b000002
b000003
```

Required block types:

- heading
- paragraph
- list
- blockquote
- table
- code fence
- inline-code-bearing paragraph
- math block
- HTML block
- image or figure reference
- caption
- footnote
- bibliography/reference entry
- unknown/raw block

Rules:

- Frontmatter is metadata and is not a translatable block.
- Do not split inside code fences, math blocks, HTML blocks, tables, citation markers, footnote markers, or Markdown links.
- `unknown_raw` is a safety fallback, not a default classification.

## Protected span contract

Extract protected spans for:

- code fences
- inline code
- math delimiters and content
- HTML tags and attributes
- URLs
- Markdown link destinations
- citation markers
- footnote markers
- identifiers
- file paths
- commands
- placeholders

These spans are used by validation and retry prompts.

## Chunking contract

Use defaults from `contracts/05-markdown-chunking.md`:

- `maxRoughTokens: 2500`
- `softRoughTokens: 1800`
- `maxBlocks: 80`
- `maxRetries: 3`
- `minLengthRatio: 0.35`
- `maxLengthRatio: 2.8`

Rules:

- Prefer section boundaries.
- Split oversized sections by contiguous block groups.
- Group adjacent small sections when safe.
- Preserve document order.
- Never split inside a block.
- Keep one oversized block whole and flag it rather than slicing it.

## Tests

Cover:

- deterministic block ids for the same source
- frontmatter excluded from translation blocks
- every required block type classification
- protected spans extracted for code, math, links, URLs, citations, footnotes, HTML, commands, paths, identifiers, and placeholders
- section path updates when headings change
- table remains one block
- code fence remains one block
- math block remains one block
- chunking groups small sections
- chunking splits oversized sections by block groups
- oversized single block is preserved and flagged

## Verification

```sh
mise exec -- bun run test tests/server/translation/markdown-blocks.test.ts
mise exec -- bun run test tests/server/translation/chunker.test.ts
mise exec -- bun run typecheck
```

`maxRetries: 3` means one initial attempt plus up to three retry attempts for a
maximum of four total attempts per chunk.

## Acceptance criteria

- Chunking is deterministic.
- Chunks preserve document order.
- Long papers can be split without relying on one Codex context window.
- Later prompt, validation, retry, and stitching subtasks can rely on stable block ids.
