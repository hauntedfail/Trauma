# 19.4 Markdown block manifest and chunker

## Goal

Parse source Markdown into deterministic chunks with parser-backed text segments so long articles and academic papers can be translated completely without asking Codex to rewrite Markdown syntax.

## Files likely owned

- `src/server/translation/markdown-blocks.ts`
- `src/server/translation/markdown-parser.ts`
- `src/server/translation/translation-segments.ts`
- `src/server/translation/chunker.ts`
- `tests/server/translation/markdown-blocks.test.ts`
- `tests/server/translation/markdown-parser.test.ts`
- `tests/server/translation/translation-segments.test.ts`
- `tests/server/translation/chunker.test.ts`
- `tests/fixtures/translation/markdown-protected-spans.md`
- `tests/fixtures/translation/markdown-segment-matrix.md`
- `tests/fixtures/translation/academic-paper.md`

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/05-markdown-chunking.md`

## Instruction alignment

Scope: deterministic chunk construction, parser-backed segment manifest creation, and legacy block compatibility only.

Inputs: source Markdown body, frontmatter parser behaviour, required block types, and chunk config defaults.

Outputs: ordered block ids for chunk grouping, ordered segment ids and source text for Codex prompts, protected structure ranges, section paths, and contiguous chunk Markdown.

Dependencies: 19.1 freezes block id format and 19.3 supplies source snapshots.

Parallelization notes: can run in parallel with Codex client work after shared translation types are frozen.

Implementation risks: growing an ad hoc regex parser to cover the full Markdown dialect will remain fragile. Markdown parsing is parser-backed. The implementation must not attempt to cover the Markdown dialect through ad hoc regex scanning. Line-oriented fallback logic may exist only for controlled diagnostics or migration compatibility.

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

The legacy block parser may still extract protected spans as guardrails, but segment extraction and structural validation are parser-backed. Extract protected ranges for:

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

These spans are legacy diagnostics and additional guardrails. They are not the primary correctness mechanism for Task 19U; parser-backed segment reassembly and structural fingerprints are.

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
- chunks include ordered text segment ids and source text
- autolinks are excluded from translatable segments
- inline HTML tags are protected while surrounding prose remains translatable
- table and footnote prose produce segments without exposing identifiers as translatable text
- oversized single block is preserved and flagged

## Verification

```sh
mise exec -- bun run test tests/server/translation/markdown-blocks.test.ts
mise exec -- bun run test tests/server/translation/markdown-parser.test.ts
mise exec -- bun run test tests/server/translation/translation-segments.test.ts
mise exec -- bun run test tests/server/translation/chunker.test.ts
mise exec -- bun run typecheck
```

`maxRetries: 3` means one initial attempt plus up to three retry attempts for a
maximum of four total attempts per chunk.

## Acceptance criteria

- Chunking is deterministic.
- Chunks preserve document order.
- Chunks expose deterministic segment ids in source order.
- Long papers can be split without relying on one Codex context window.
- Later prompt, validation, retry, and stitching subtasks can rely on stable segment ids and reassembled chunk Markdown.
