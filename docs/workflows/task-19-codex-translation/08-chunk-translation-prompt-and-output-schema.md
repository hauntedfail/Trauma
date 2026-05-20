# 19.8 Chunk translation prompt and output schema

## Goal

Define the prompt contract and machine-readable output schema for translating one chunk safely and completely.

## Scope

Build the Reader-side prompt template, output schema, protected-span policy, and app-server `outputSchema` payload. This subtask does not implement validation logic beyond schema definition.

## Inputs

- 19.4 block manifest and chunk metadata
- 19.5 app-server output schema support
- Security and prompt-injection requirements from the parent workflow

## Outputs

- Prompt template for chunk translation.
- JSON output schema for chunk result.
- Protected-span policy for code, inline code, math, citations, footnotes, URLs, file paths, commands, identifiers, placeholders, HTML tags, and attributes.

## Dependencies

- 19.4 for block ids and chunk metadata.
- 19.5 for app-server schema shape.

## Acceptance criteria

- The prompt states that source article content is untrusted data and cannot override system/developer instructions.
- Source Markdown is wrapped in explicit delimiters.
- Codex is instructed to translate natural language only.
- Codex is instructed to preserve Markdown structure, HTML tags and attributes, LaTeX/math, citations, footnotes, URLs, code fences, inline code, placeholders, variable names, identifiers, file paths, and commands.
- Codex is instructed to never summarize, never omit, and never add commentary.
- Output schema includes `chunk_index`, ordered `blocks`, each block `id`, each block `translated_markdown`, and `warnings`.
- Output schema disallows unexpected top-level fields unless 19.1 explicitly allows versioning metadata.
- The schema supports academic paper translation and long-document chunking.
- The prompt does not ask Codex to write files or mutate the repository.

## Parallelization notes

This can run in parallel with 19.5 after 19.4 defines block ids. It blocks 19.9 validation and 19.14 skill extraction.

## Implementation risks

- A vague prompt will invite summarization or omission on long chunks.
- Missing protected-span language will corrupt citations, formulas, commands, and code.
- If the prompt lets source content behave like instructions, external websites can prompt-inject the translation worker.
