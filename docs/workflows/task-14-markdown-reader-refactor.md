# Task 14: Markdown Reader Refactor Workflow

## Goal

Refactor the markdown reader into a maintainable pipeline based on the Task 13
decision, while preserving reader behavior that is already part of the product
contract.

## Required Context

- [Task 13](task-13-markdown-reader-library-decision.md)
- [UI and routing architecture](../architecture/ui-and-routing.md)
- [Security boundaries](../references/coding-standards/security-boundaries.md)
- [Testing and verification rules](../references/coding-standards/testing-verification.md)

## Ownership

Primary files and directories:

- `src/server/reader/**`
- `src/components/reader/**` only for reader-facing data shape changes.
- `tests/server/reader/**`
- Reader-focused E2E fixtures if needed.
- `package.json` and `bun.lock` if Task 13 selected a dependency change.

Do not implement highlight creation/toggle persistence in this task. Preserve
existing persisted `<mark data-highlight-id>` rendering behavior only.

Unless `docs/references/reader-pipeline-decision.md` explicitly overrides the
module boundaries, use this structure:

- `src/server/reader/markdown-renderer.ts`: public facade exporting
  `renderMemoryMarkdown`.
- `src/server/reader/markdown-converter.ts`: selected library setup and
  markdown-to-HTML conversion.
- `src/server/reader/reader-sanitizer.ts`: `sanitize-html` or selected
  sanitizer allowlist and transforms.
- `src/server/reader/reader-toc.ts`: heading ID and table-of-contents
  extraction.
- `src/server/reader/reader-embeds.ts`: iframe host and capability policy.
- `src/server/reader/code-highlighting.ts`: code fence highlighting.
- `src/server/reader/highlight-mark-policy.ts`: persisted highlight mark
  validation and transform policy.

## Implementation Steps

1. Create a reader contract test fixture.
   - Include headings, GFM tables, task lists, footnotes, code fences,
     auto-linked URLs, unsafe HTML, allowed iframe embeds, disallowed iframe
     embeds, images, and highlight marks.
   - Assert HTML output only where the product contract requires exact output.
   - Prefer semantic assertions for formatting that may vary by library.

2. Split pipeline responsibilities.
   - Parser/markdown conversion.
   - Syntax highlighting.
   - ToC extraction.
   - Sanitization.
   - Controlled embed policy.
   - Highlight mark preservation.
   - Keep the facade small enough that route components do not import internal
     pipeline modules.

3. Implement the selected pipeline.
   - Follow the Task 13 decision.
   - Keep Trauma policy code local and explicit.
   - Do not expose raw unsanitized HTML to route components.

4. Remove obsolete code.
   - Delete custom helpers that are replaced by the selected library.
   - Keep local helpers only when they encode Trauma-specific policy.
   - Avoid carrying both old and new pipelines.

5. Update tests.
   - Preserve existing reader tests where they encode product behavior.
   - Replace brittle exact-string tests with semantic assertions when the
     selected library produces equivalent safe HTML.
   - Add regression coverage for sanitizer and highlight mark behavior.

6. Update docs only if behavior changes.
   - If supported markdown features change, update UI/routing architecture.
   - If dependencies change, update technology-stack references.

## Acceptance Criteria

- Reader responsibilities are split into focused modules or clearly separated
  functions.
- `src/server/reader/markdown-renderer.ts` remains the public facade.
- Unsafe HTML is sanitized before browser rendering.
- `<mark data-highlight-id>` survives sanitization only when valid.
- Controlled embed policy is covered by tests.
- ToC and heading anchor behavior are covered by tests.
- Existing reader route still renders fixture content.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Run E2E if route/component behavior changes:

```bash
bun run test:e2e
```

## PR Handoff

The PR description must include:

- Pipeline modules or responsibilities after the refactor.
- Behavior intentionally preserved.
- Behavior intentionally changed, if any.
- Sanitization and embed policy summary.
- Exact verification commands and outcomes.
