# Task 13: Markdown Reader Library Decision Workflow

## Goal

Decide the reader pipeline direction before further refactoring. The output is a
clear implementation decision, not a partial reader rewrite.

## Required Context

- [UI and routing architecture](../architecture/ui-and-routing.md)
- [Data and storage architecture](../architecture/data-and-storage.md)
- [Technology stack](../references/technology-stack.md)
- [Security boundaries](../references/coding-standards/security-boundaries.md)
- Current reader implementation in `src/server/reader/markdown-renderer.ts`.

## Ownership

Primary files and directories:

- Create `docs/references/reader-pipeline-decision.md`.
- Modify `docs/references/technology-stack.md` only if the selected reader
  stack changes.
- Modify `docs/architecture/ui-and-routing.md` only if the supported reader
  behavior changes.
- Reader-focused spike files under temporary or test-only paths if needed.
- `package.json` and `bun.lock` only if a spike requires installing a candidate
  dependency for verification.

Do not rewrite production reader behavior in this task.

## Decision Options

Evaluate at least these options:

- Keep `markdown-it`, but split the pipeline into focused modules.
- Move to `unified` / `remark` / `rehype` for AST-first processing.
- Hybrid: keep `markdown-it` for markdown parsing and move only sanitization,
  embeds, ToC, or highlight handling behind stricter local boundaries.

## Evaluation Criteria

Each option must be scored from 1 to 5 against:

- Bun and SolidStart SSR compatibility.
- TypeScript type quality.
- GitHub Flavored Markdown support.
- Footnotes, heading anchors, ToC, task lists, and tables.
- Syntax highlighting integration.
- HTML sanitization and controlled embed policy.
- Preservation of `<mark data-highlight-id>`.
- Testability of each stage.
- Maintenance cost and dependency surface.
- Migration risk from the current reader tests.

## Implementation Steps

1. Capture current reader responsibilities.
   - List each responsibility currently inside
     `src/server/reader/markdown-renderer.ts`.
   - Identify which responsibilities are parser concerns and which are Trauma
     policy concerns.

2. Research library candidates.
   - Use current official docs for candidate APIs.
   - Record only decision-relevant facts.
   - Avoid copying long documentation excerpts.

3. Build a small spike if necessary.
   - Use a representative markdown fixture with headings, GFM tables, task
     lists, footnotes, code fences, unsafe HTML, embeds, and highlight marks.
   - Keep spike code out of production paths unless it becomes the final
     implementation in Task 14.

4. Write the decision document.
   - Create `docs/references/reader-pipeline-decision.md`.
   - Include a scored matrix for `markdown-it`, `unified/remark/rehype`, and
     the hybrid option.
   - State selected option, rejected options, and why.
   - State whether Task 14 should change dependencies.
   - State exact follow-up scope for Task 14.
   - State any module-boundary override for Task 14. If no override is written,
     Task 14 must use its default module boundaries.

5. Keep docs lean.
   - Update technology-stack or architecture docs only if the selected reader
     stack changes.
   - Do not add a PR-history narrative.

## Acceptance Criteria

- A single reader direction is selected.
- `docs/references/reader-pipeline-decision.md` exists and contains the scored
  option matrix.
- The decision covers security, highlighting, ToC, embeds, and tests.
- Task 14 can proceed without re-litigating library choice or module
  boundaries.
- No production reader behavior changes in this task.

## Verification

Run any spike-specific checks and then:

```bash
bun run typecheck
bun run test
```

If dependencies are changed for the decision, also run:

```bash
bun run build
```

## PR Handoff

The PR description must include:

- Selected reader approach.
- Rejected alternatives and reasons.
- Dependency changes, if any.
- Exact Task 14 follow-up scope.
- Exact verification commands and outcomes.
