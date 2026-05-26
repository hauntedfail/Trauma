# Task 19W.05: Browse, Flashbacks Route, Deletion, And Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include translated Flashbacks in global list/search surfaces and make deletion/export variant-aware.

**Architecture:** Global browse rows include variant identity. Renderability filtering reads the correct source or translated `CONTENT.md` for each row and hides stale translated output hashes. Links and deletion requests preserve `langCode` for translated rows.

**Tech Stack:** Flashback browse loader, memory browse loader, Solid components, backup/export JSON, Vitest component/server tests.

---

## Role

Browse and backup/export owner.

This worker must not change the database schema.

## Files

- Modify: `src/server/flashbacks/browse.ts`
- Modify: `src/server/flashbacks/export.ts`
- Modify: `src/server/flashbacks/toggle.ts`
- Modify: `src/server/memories/browse.ts`
- Modify: `src/components/memories/browse-data.ts`
- Modify: `src/components/memories/memory-anchor-hrefs.ts`
- Modify: `src/components/flashbacks/FlashbackActionMenu.tsx`
- Modify: `src/routes/flashbacks/index.tsx`
- Test: `tests/server/flashbacks/repository.test.ts`
- Test: `tests/server/memories/browse.test.ts`
- Test: `tests/components/flashbacks-loader.test.ts`
- Test: `tests/components/flashback-action-menu.test.ts`
- Test: `tests/memories/browse-data.test.ts`

## Browse Row Contract

Extend `FlashbackBrowseRow` and corresponding component data:

```ts
variantKind: "source" | "translation";
langCode: SupportedLanguageCode | null;
translationOutputHash: string | null;
```

Add link helper:

```ts
export function buildMemoryVariantAnchorHref(input: {
  anchorId?: null | string;
  langCode?: null | string;
  memoryId: string;
}): string {
  const memoryPath = input.langCode === undefined || input.langCode === null
    ? buildMemoryHref(input.memoryId)
    : `/memories/${encodeURIComponent(input.langCode)}/${encodeURIComponent(input.memoryId)}`;
  const anchorId = input.anchorId?.trim() ?? "";
  return anchorId.length === 0
    ? memoryPath
    : `${memoryPath}${buildSameMemoryAnchorHref(anchorId)}`;
}
```

## Export Contract

`getFlashbackMetadataExportPath` becomes variant-aware:

```ts
export function getFlashbackMetadataExportPath(input: {
  memoryId: string;
  variant: FlashbackVariant;
}): string {
  if (input.variant.kind === "source") {
    return `memories/${input.memoryId}/FLASHBACKS.json`;
  }
  return `memories/${input.memoryId}/${input.variant.langCode}/FLASHBACKS.json`;
}
```

Keep a compatibility wrapper only where tests still need the old source path:

```ts
export function getSourceFlashbackMetadataExportPath(memoryId: string): string {
  return getFlashbackMetadataExportPath({
    memoryId,
    variant: sourceFlashbackVariant,
  });
}
```

## Task Steps

- [ ] **Step 1: Write global browse test**

In `tests/server/flashbacks/repository.test.ts`, seed one source row and one translated row. Assert `listForBrowse()` returns both and includes variant identity.

Expected shape:

```ts
expect(rows).toEqual([
  expect.objectContaining({
    id: "translated-new",
    variantKind: "translation",
    langCode: "ja-JP",
    translationOutputHash: "sha256:" + "a".repeat(64),
  }),
  expect.objectContaining({
    id: "source-old",
    variantKind: "source",
    langCode: null,
    translationOutputHash: null,
  }),
]);
```

- [ ] **Step 2: Write renderability test**

In `tests/server/memories/browse.test.ts`, seed:

- current translation output hash `sha256:a...`,
- translated Flashback with matching hash,
- translated Flashback with stale hash.

Assert browse memory rows include the matching translated row and hide the stale row.

- [ ] **Step 3: Write link and delete component tests**

In `tests/memories/browse-data.test.ts`, assert translated Flashback links build:

```ts
expect(buildMemoryVariantAnchorHref({
  memoryId: "memory-1",
  langCode: "ja-JP",
  anchorId: "flashback-1",
})).toBe("/memories/ja-JP/memory-1#flashback-1");
```

In `tests/components/flashback-action-menu.test.ts`, assert delete sends:

```json
{
  "memoryId": "memory-1",
  "langCode": "ja-JP",
  "operation": "unflashback"
}
```

for translated rows.

- [ ] **Step 4: Verify RED**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/flashbacks/repository.test.ts tests/server/memories/browse.test.ts tests/components/flashbacks-loader.test.ts tests/components/flashback-action-menu.test.ts tests/memories/browse-data.test.ts
```

Expected: FAIL because browse rows, links, delete payloads, and export paths are still source-only.

- [ ] **Step 5: Implement variant-aware browse filtering**

Update `filterRenderableFlashbackRows` to group by:

```ts
`${row.memoryId}:${row.variantKind}:${row.langCode ?? ""}:${row.translationOutputHash ?? ""}`
```

For source rows, read source `CONTENT.md`.

For translation rows:

1. Resolve current translation for `row.memoryId + row.langCode`.
2. Require `current.status === "current"`.
3. Require `current.outputHash === row.translationOutputHash`.
4. Read translated `CONTENT.md`.
5. Apply markers to translated Markdown.

- [ ] **Step 6: Implement variant-aware links and deletion**

Update `/flashbacks` and memory browse right-rail links to call `buildMemoryVariantAnchorHref`. Update `FlashbackActionMenuItem` with optional `langCode`, and include `langCode` in the delete body for translated rows.

- [ ] **Step 7: Implement variant-aware export**

Update `writeFlashbackMetadataExport` to accept `variant`. Include variant identity in the JSON payload:

```json
{
  "version": 2,
  "memoryId": "...",
  "variant": {
    "kind": "translation",
    "langCode": "ja-JP",
    "translationOutputHash": "sha256:..."
  },
  "flashbacks": []
}
```

Source exports may remain version `1` only if that avoids rewriting existing source backup fixtures. If source remains version `1`, translated exports must still include variant identity.

- [ ] **Step 8: Verify this slice**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/flashbacks/repository.test.ts tests/server/memories/browse.test.ts tests/components/flashbacks-loader.test.ts tests/components/flashback-action-menu.test.ts tests/memories/browse-data.test.ts tests/server/backup/git-backup.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Global Flashback surfaces include translated rows, links route to the correct variant, deletion is variant-scoped, and backup/export artifacts are variant-aware.
