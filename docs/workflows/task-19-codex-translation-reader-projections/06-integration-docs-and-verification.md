# Task 19V.06: Integration Docs And Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify cross-variant annotations end to end and update durable docs so future work does not reintroduce source-only annotation behavior.

**Architecture:** This task adds integration coverage across translation commit, translated reader rendering, translated Flashback toggle, translated Moment toggle, and stale projection failures. It updates architecture docs after behavior is implemented.

**Tech Stack:** TypeScript, Vitest, Playwright where practical, docs under `docs/architecture/` and `docs/workflows/`.

---

## Role

Integration and documentation owner.

This worker must not introduce new architecture. It validates the completed behavior and updates docs to match the implementation.

## Files

- Modify: `docs/architecture/data-and-storage.md`
- Modify: `docs/architecture/flows.md`
- Modify: `docs/architecture/ui-and-routing.md`
- Modify: `docs/workflows/task-19-codex-translation.md`
- Modify: `docs/workflows/task-19-codex-translation/10-stitching-and-atomic-commit.md`
- Modify: `docs/workflows/task-19-codex-translation/11-sqlite-cleanup-and-purge-policy.md`
- Modify: `docs/workflows/task-19-codex-translation/13-reader-render-integration-for-translated-content.md`
- Modify: `docs/workflows/task-19-codex-translation/contracts/03-sqlite-and-repositories.md`
- Modify: `docs/workflows/task-19-codex-translation/contracts/07-atomic-commit-purge-recovery.md`
- Test: `tests/server/translation/runner.test.ts`
- Test: `tests/server/reader/page-data.test.ts`
- Test: `tests/server/routes/api-flashbacks-toggle.test.ts`
- Test: `tests/server/routes/api-moments.test.ts`
- Optional E2E: `tests/e2e/translated-reader-annotations.spec.ts`

## Required Integration Scenarios

Add focused coverage for:

1. Translation commit writes `CONTENT.md`, `TRANSLATION_MAP.json`, and projection rows.
2. Completed chunk `translated_markdown` and temporary projection JSON are purged.
3. Source Flashback renders on translated reader using projected Japanese text.
4. Translated Flashback selection writes canonical English source row.
5. Source Moment active state appears on translated heading with the same path.
6. Translated Moment selection writes canonical source Moment row.
7. Missing projection map disables translated annotation mutation with 409.
8. Stale projection hash disables translated annotation rendering and mutation.

## Task Steps

- [ ] **Step 1: Add integration tests**

Add tests that use a short source/translated fixture:

```md
# Reader Projection Fixture

Top 5 repos defining it, the academic case for why, and who says it's wrong.

## Why it matters

Second section body.
```

Translated text:

```md
# リーダー投影フィクスチャ

それを定義するトップ5リポジトリ、なぜそうなるかの学術的根拠、そしてそれが誤りだとする立場。

## なぜ重要か

2番目のセクション本文。
```

Assert source canonical rows remain English/source identity while translated reader renders Japanese projected snippets.

- [ ] **Step 2: Verify focused RED or PASS from previous subtasks**

Run:

```sh
mise exec -- bun run test tests/server/translation/runner.test.ts tests/server/reader/page-data.test.ts tests/server/routes/api-flashbacks-toggle.test.ts tests/server/routes/api-moments.test.ts
```

Expected: PASS if subtasks 19V.01-19V.05 are complete; otherwise fail at the missing integration boundary.

- [ ] **Step 3: Update architecture docs**

Document:

- `flashbacks` and `moments` remain source canonical.
- `translation_projection_spans` is runtime projection state.
- `TRANSLATION_MAP.json` is a backup/export artifact.
- translated reader annotations fail closed when projection is missing or stale.
- arbitrary sub-sentence cross-language selection is not guessed in Task 19V.

- [ ] **Step 4: Update Task 19 docs**

Update Task 19 translation docs so completed translation identity includes the projection sidecar as part of commit output. Update cleanup docs so temporary chunk projection data is purged but durable projection rows remain.

- [ ] **Step 5: Run focused verification**

Run:

```sh
mise exec -- bun run test tests/server/translation/translation-projection-map.test.ts tests/server/translation/runner.test.ts tests/server/reader/page-data.test.ts tests/server/routes/api-flashbacks-toggle.test.ts tests/server/routes/api-moments.test.ts tests/components/memory-reader-actions.test.ts tests/components/reader-moment-actions.test.ts
mise exec -- bun run typecheck
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Run full verification**

Run:

```sh
mise exec -- bun run verify
```

Expected: typecheck, unit tests, and build pass. If the build emits the existing `temml` deprecation warning, record it as non-failing only when exit code is 0.

## Handoff

Task 19V is complete only after docs and tests agree that translated reader annotations are projection-backed, canonical source metadata remains single-source-of-truth, and stale or partial projection cases fail closed.
