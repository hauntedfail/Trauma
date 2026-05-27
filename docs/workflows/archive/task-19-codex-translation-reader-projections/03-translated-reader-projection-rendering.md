# Task 19V.03: Translated Reader Projection Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render canonical source Flashbacks and Moment active state on translated reader variants.

**Architecture:** `loadReaderMemory(memoryId, { langCode })` resolves the current translation, loads projection spans, projects canonical source annotations into translated reader ranges, and renders translated Markdown with transient marks. Source reader behavior remains unchanged.

**Tech Stack:** TypeScript, Vitest, existing reader page-data loader, reader markdown renderer, projection repository from Task 19V.01.

---

## Role

Reader read-path owner.

This worker must not implement mutation APIs. It makes translated reader variants display already-saved canonical annotations.

## Files

- Modify: `src/server/reader/page-data.ts`
- Modify: `src/server/flashbacks/toggle.ts`
- Modify: `src/server/store/flashback-markers.ts`
- Modify: `src/components/reader/MemoryReader.tsx`
- Test: `tests/server/reader/page-data.test.ts`
- Test: `tests/server/flashbacks/flashback-markers.test.ts`
- Test: `tests/components/memory-reader-actions.test.ts`
- Test: `tests/components/reader-moment-actions.test.ts`

## Projection Rules

Add server helper:

```ts
export function projectFlashbacksToTranslatedRanges(input: {
  flashbacks: ReaderFlashbackItem[];
  projectionSpans: TranslationProjectionSpan[];
}): ReaderFlashbackItem[];
```

It must:

- require every projected source range to align exactly with one or more adjacent projection spans,
- return translated `text`, `prefix`, `suffix`, `startOffset`, and `endOffset`,
- keep the original Flashback `id` and `createdAt`,
- drop unprojectable Flashbacks from translated rendering.

Moment active state uses `sectionPath`:

```ts
resolveReaderMomentTarget(moment, translatedToc)
```

must keep using exact `(sectionAnchor, sectionPath)` first, then unique `sectionPath` fallback. No language-specific Moment rows are created.

## Task Steps

- [ ] **Step 1: Write translated Flashback rendering test**

Add a `loadReaderMemory(memoryId, { langCode: "ja-JP" })` fixture with:

- source `CONTENT.md` containing the English sentence,
- translated `CONTENT.md` containing the Japanese sentence,
- one canonical source Flashback row,
- one current translation job,
- one projection span.

Assert:

```ts
expect(result.rendered.html).toContain(
  '<mark data-flashback-id="flashback-1" id="flashback-1">それを定義するトップ5リポジトリ'
);
expect(result.memory.flashbacks[0]).toMatchObject({
  id: "flashback-1",
  text: "それを定義するトップ5リポジトリ、なぜそうなるかの学術的根拠、そしてそれが誤りだとする立場。",
});
```

- [ ] **Step 2: Write stale projection test**

Assert translated reader does not render a Flashback when projection rows are missing or when `outputHash` differs from the current translated file hash.

- [ ] **Step 3: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/reader/page-data.test.ts tests/server/flashbacks/flashback-markers.test.ts tests/components/memory-reader-actions.test.ts tests/components/reader-moment-actions.test.ts
```

Expected: FAIL because translated reader still skips Flashbacks.

- [ ] **Step 4: Load projection spans in translated reader path**

In `readTranslatedReaderContent()` or adjacent page-data helper, return:

```ts
{
  markdown,
  relativePath,
  currentTranslation,
  projectionSpans,
}
```

Only query spans after `resolveCurrentTranslationReadOnly()` returns `current`, using the current `sourceHash` and `outputHash`.

- [ ] **Step 5: Render projected Flashbacks**

Change `renderMemoryMarkdownSafely()` call so translated readers pass projected Flashbacks instead of an empty array. Keep source readers passing `memory.flashbacks`.

- [ ] **Step 6: Surface projected state to frontend**

`toReaderMemory()` should receive the active variant's rendered Flashbacks so the right rail current-memory tab lists translated snippets on translated routes. The canonical ids remain unchanged.

- [ ] **Step 7: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/reader/page-data.test.ts tests/server/flashbacks/flashback-markers.test.ts tests/components/memory-reader-actions.test.ts tests/components/reader-moment-actions.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Translated reader routes now display projected annotations but still cannot create or remove them from translated selections. Mutation workers must use the same projection rules and fail closed when projection is missing or partial.
