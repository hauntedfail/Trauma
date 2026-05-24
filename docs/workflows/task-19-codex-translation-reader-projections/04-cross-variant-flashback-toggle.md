# Task 19V.04: Cross-Variant Flashback Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow translated reader text selections to create or remove canonical source Flashbacks through exact reverse projection.

**Architecture:** The frontend includes the active reader variant in the Flashback toggle payload. The server resolves source selections normally, and resolves translated selections by mapping translated reader offsets back to source reader offsets through the current projection map before applying existing range merge/split logic.

**Tech Stack:** TypeScript, Solid component tests, SolidStart API route tests, existing Flashback toggle service, projection repository.

---

## Role

Flashback mutation owner.

This worker must not change Moment APIs or translation commit behavior.

## Files

- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/routes/api/flashbacks.ts`
- Modify: `src/server/flashbacks/toggle.ts`
- Modify: `src/server/store/flashback-markers.ts`
- Test: `tests/server/routes/api-flashbacks-toggle.test.ts`
- Test: `tests/server/flashbacks/toggle.test.ts`
- Test: `tests/components/memory-reader-actions.test.ts`
- Test: `tests/server/flashbacks/flashback-markers.test.ts`

## API Contract

Extend `POST /api/flashbacks` payload:

```json
{
  "memoryId": "019e...",
  "operation": "flashback",
  "langCode": "ja-JP",
  "selection": {
    "text": "それを定義するトップ5リポジトリ、なぜそうなるかの学術的根拠、そしてそれが誤りだとする立場。",
    "prefix": "",
    "suffix": "",
    "startOffset": 0,
    "endOffset": 45
  }
}
```

Source reader payloads omit `langCode`.

Stable errors:

- `missing_projection`: current translation has no projection map.
- `stale_projection`: projection map does not match current source or output hash.
- `ambiguous_projection`: selected translated range maps to multiple non-adjacent source ranges.
- `partial_projection`: selection starts or ends inside one projection span.

Return these as HTTP 409 with `{ "error": "...", "code": "<code>" }`.

## Task Steps

- [ ] **Step 1: Write API payload tests**

Assert the parser accepts source and translation variants and rejects unknown keys:

```ts
expect(await parseFlashbackTogglePayload(request)).toMatchObject({
  ok: true,
  langCode: "ja-JP",
});
```

- [ ] **Step 2: Write reverse projection service test**

Create a source sentence, translated sentence, projection span, and translated selection. Assert `toggleMemoryFlashback()` writes a canonical Flashback row whose `text` is the source English sentence while the API response returns active variant snippets for the translated reader.

- [ ] **Step 3: Write partial projection rejection test**

Select only half of the translated sentence and assert:

```ts
await expect(toggleMemoryFlashback(input)).rejects.toMatchObject({
  code: "partial_projection",
});
```

- [ ] **Step 4: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/routes/api-flashbacks-toggle.test.ts tests/server/flashbacks/toggle.test.ts tests/components/memory-reader-actions.test.ts tests/server/flashbacks/flashback-markers.test.ts
```

Expected: FAIL because Flashback API only accepts source selections.

- [ ] **Step 5: Extend frontend payload**

In `MemoryReader.tsx`, derive:

```ts
const langCode = props.result.content.langCode;
```

Include `langCode` in the `/api/flashbacks` body only for translated routes.

- [ ] **Step 6: Extend route parsing**

Parse optional `langCode` in `src/routes/api/flashbacks.ts`. Keep old source payloads backward-compatible. Add `code` to formatted 409 errors when stable projection error codes are introduced.

- [ ] **Step 7: Implement reverse projection**

In `toggleMemoryFlashback()`:

- source variant follows the current path,
- translated variant resolves current translation,
- loads projection spans by current source/output hash,
- maps translated reader range to one adjacent source reader range,
- calls existing source Markdown selection resolver with the projected source selection,
- returns projected active-variant Flashbacks when the request came from a translated reader.

- [ ] **Step 8: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/routes/api-flashbacks-toggle.test.ts tests/server/flashbacks/toggle.test.ts tests/components/memory-reader-actions.test.ts tests/server/flashbacks/flashback-markers.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Translated Flashback toggle is available only when projection is exact. Existing source Flashback behavior, range merging, range splitting, export writing, and backup enqueue behavior must remain unchanged.
