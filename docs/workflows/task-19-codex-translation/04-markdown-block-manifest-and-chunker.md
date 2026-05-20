# 19.4 Markdown block manifest and chunker

## Goal

Parse source Markdown into deterministic blocks and chunk contiguous block groups for complete long-document translation.

## Scope

Build the Reader-side block manifest generator, protected-span tracking, section-aware chunker, and chunk metadata builder. Do not call Codex in this subtask.

## Inputs

- Source `memory/<memory_id>/CONTENT.md`
- Existing Markdown/frontmatter parser behavior
- 19.1 frozen block id and chunk metadata contracts

## Outputs

- Block manifest with stable ids such as `b000001`.
- Block types for heading, paragraph, list, blockquote, table, code fence, inline-code-bearing paragraph, math block, HTML block, image or figure reference, caption, footnote, bibliography/reference entry, and unknown/raw block.
- Chunk manifest with contiguous block groups and metadata.
- Configurable chunk size defaults.

## Dependencies

- 19.1 for manifest contract.
- 19.2 if chunk metadata is persisted immediately.

## Acceptance criteria

- Block ids are deterministic for the same source content.
- Chunking preserves source document order.
- Chunking prefers section boundaries but can split oversized sections by block groups.
- Multiple small sections may be grouped when within configured limits.
- The chunker does not split inside code fences, math blocks, unsafe HTML structures, citation markers, footnote markers, Markdown links, or ordinary tables.
- Extremely large table row-group splitting is not implemented unless the task explicitly defines row-level validation.
- Each chunk includes `memory_id`, `target_lang`, `source_hash`, `chunk_index`, `chunk_count`, `section_path`, `doc_title`, `source_url`, `document_type`, `style_profile`, and `glossary` when available.
- The final committed translated `CONTENT.md` is not required to preserve internal block comments.

## Parallelization notes

This can run in parallel with 19.2 after 19.1. It blocks 19.8, 19.9, 19.10, and long-paper validation.

## Implementation risks

- Raw character slicing can corrupt Markdown and make validation impossible.
- Missing protected-span metadata will let Codex translate identifiers, URLs, citations, commands, or code.
- Non-deterministic block ids will break retry, stitching, and stale-job recovery.
