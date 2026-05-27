# Task 19W.06: Docs Cleanup And Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale Flashback projection claims from durable docs and verify the full variant-local implementation.

**Architecture:** Durable docs should describe Flashbacks as variant-local. Task 19V remains a historical projection plan, but workers must not execute its Flashback subtasks after Task 19W is approved.

**Tech Stack:** Markdown docs, Vitest, typecheck, full `bun run verify`.

---

## Role

Integration and documentation owner.

This worker must not introduce new product behavior.

## Files

- Modify: `docs/architecture/data-and-storage.md`
- Modify: `docs/architecture/flows.md`
- Modify: `docs/architecture/ui-and-routing.md`
- Modify: `docs/workflows/README.md`
- Modify: `docs/workflows/task-19-codex-translation.md`
- Modify: `docs/workflows/task-19-codex-translation/13-reader-render-integration-for-translated-content.md`
- Modify: `docs/workflows/task-19-codex-translation-reader-projections.md`
- Test: `tests/server/routes/api-flashbacks-toggle.test.ts`
- Test: `tests/server/reader/page-data.test.ts`
- Test: `tests/server/memories/browse.test.ts`
- Test: `tests/components/flashback-action-menu.test.ts`

## Documentation Contract

Use this wording in durable docs:

```md
Flashbacks are local to the reader content variant where they are created.
Source Flashbacks use source reader offsets. Translated Flashbacks use translated
reader offsets and are scoped to the completed translation output hash. Global
Flashback browse and memory search surfaces include renderable Flashbacks from
both source and translated variants.
```

Remove or rewrite old projection-era claims that say translated Flashbacks are
derived from source rows, translated writes mutate source rows, translated
readers show source Flashbacks through alignment data, or translated Flashback
creation fails because an alignment span is only partially covered.

Keep translation projection documentation only for translation maps and future non-Flashback uses.

## Task Steps

- [ ] **Step 1: Add final integration assertions**

Add one integration test that exercises the full flow after previous subtasks:

```ts
const source = await loadReaderMemory(memoryId, { config });
const translated = await loadReaderMemory(memoryId, {
  config,
  langCode: "ja-JP",
});

expect(source.status).toBe("ready");
expect(translated.status).toBe("ready");
expect(source.memory.flashbacks.map((row) => row.variantKind)).toEqual([
  "source",
]);
expect(translated.memory.flashbacks.map((row) => row.variantKind)).toEqual([
  "translation",
]);
```

- [ ] **Step 2: Run focused verification before docs**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/routes/api-flashbacks-toggle.test.ts tests/server/reader/page-data.test.ts tests/server/memories/browse.test.ts tests/components/flashback-action-menu.test.ts
```

Expected: PASS if implementation subtasks are complete.

- [ ] **Step 3: Update architecture docs**

Update:

- `docs/architecture/data-and-storage.md`: variant-aware `flashbacks` columns, translated export path, stale output hash behavior.
- `docs/architecture/flows.md`: translated Flashback toggle resolves active translated content and never writes back into source rows.
- `docs/architecture/ui-and-routing.md`: translated reader shows translated Flashbacks only; `/flashbacks` shows all renderable variants.

- [ ] **Step 4: Update Task 19 docs**

Update Task 19 translation docs so reader rendering no longer promises canonical Flashback projection. Keep `translation_projection_spans` as translation alignment data, but remove it from Flashback write requirements.

- [ ] **Step 5: Mark Task 19V Flashback work superseded**

At the top of `docs/workflows/task-19-codex-translation-reader-projections.md`, add:

```md
> Superseded for Flashbacks by Task 19W. Do not execute Task 19V Flashback
> subtasks for translated Flashback behavior. Task 19V remains a historical
> projection design record and may inform future Moment or alignment work only
> after a new plan approves that scope.
```

- [ ] **Step 6: Run stale-doc search**

Run:

```sh
rg -n "Flashbacks.*source.canonical|reverse.?project|project.canonical.Flashbacks|projected.snippets|partial.projection|projection.map" docs src tests
```

Expected: remaining matches are either non-Flashback projection docs, archived history, or the Task 19V supersession note. Update active docs until the result is unambiguous.

- [ ] **Step 7: Run final verification**

Run:

```sh
mise exec -- bun run typecheck
mise exec -- bun --bun x vitest run tests/server/routes/api-flashbacks-toggle.test.ts tests/server/reader/page-data.test.ts tests/server/memories/browse.test.ts tests/components/flashback-action-menu.test.ts tests/server/backup/git-backup.test.ts
git diff --check
mise exec -- bun run verify
```

Expected: all commands pass. If full verification emits an existing non-failing dependency warning, record the exact warning and exit code.

## Handoff

Task 19W is complete when implementation, docs, and tests all agree that Flashbacks are variant-local and global Flashback surfaces union all renderable variants.
