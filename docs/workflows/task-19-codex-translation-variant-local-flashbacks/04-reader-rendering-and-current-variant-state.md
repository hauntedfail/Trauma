# Task 19W.04: Reader Rendering And Current-Variant State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only the active reader variant's Flashbacks and keep the right-rail "Current" tab scoped to that variant.

**Architecture:** Reader load resolves content first, then asks the repository for Flashbacks matching the active variant. Source routes use `{ kind: "source" }`; translated routes use `{ kind: "translation", langCode, outputHash }`. The existing marker renderer applies rows to the active Markdown only.

**Tech Stack:** Reader server data loader, existing markdown renderer, Solid reader component, Vitest reader tests.

---

## Role

Reader owner.

This worker must not change global `/flashbacks` browse behavior.

## Files

- Modify: `src/server/reader/page-data.ts`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/components/reader/reader-memory-loader.ts`
- Test: `tests/server/reader/page-data.test.ts`
- Test: `tests/components/memory-reader-actions.test.ts`
- Test: `tests/components/memory-reader-flashback-selection.test.ts`

## Reader Contract

`ReaderFlashbackItem` should carry variant identity:

```ts
export interface ReaderFlashbackItem {
  id: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  contentHash?: string | null;
  variantKind: "source" | "translation";
  langCode?: SupportedLanguageCode | null;
  translationOutputHash?: string | null;
  createdAt: string;
}
```

`loadReaderMemory` should compute:

```ts
const activeVariant = content.langCode === undefined
  ? sourceFlashbackVariant
  : {
      kind: "translation" as const,
      langCode: content.langCode,
      outputHash: content.outputHash,
    };
```

Then:

```ts
const flashbackMarkers =
  await connection.repositories.flashbacks.listForMemoryVariant({
    memoryId,
    variant: activeVariant,
  });
```

Remove Flashback rendering through `projectFlashbacksToTranslatedReader`.

## Task Steps

- [ ] **Step 1: Write reader isolation test**

In `tests/server/reader/page-data.test.ts`, seed:

- source `CONTENT.md`: `Source Jean Baudrillard sentence.`
- translated `CONTENT.md`: `翻訳されたジャン・ボードリヤールの文。`
- one source Flashback on `Source Jean Baudrillard`,
- one translated Flashback on `ジャン・ボードリヤール` with current output hash.

Assert:

```ts
const source = await loadReaderMemory(memoryId, { config });
expect(source.status).toBe("ready");
expect(source.memory.flashbacks.map((row) => row.text)).toEqual([
  "Source Jean Baudrillard",
]);
expect(source.rendered.html).toContain("data-flashback-id=\"source-flashback\"");
expect(source.rendered.html).not.toContain("translated-flashback");

const translated = await loadReaderMemory(memoryId, {
  config,
  langCode: "ja-JP",
});
expect(translated.status).toBe("ready");
expect(translated.memory.flashbacks.map((row) => row.text)).toEqual([
  "ジャン・ボードリヤール",
]);
expect(translated.rendered.html).toContain("data-flashback-id=\"translated-flashback\"");
expect(translated.rendered.html).not.toContain("source-flashback");
```

- [ ] **Step 2: Write stale translation hash test**

Seed a translated Flashback with `translation_output_hash = "sha256:" + "b".repeat(64)` while the current translation output hash is `"sha256:" + "a".repeat(64)`. Assert translated reader renders no Flashback rows.

- [ ] **Step 3: Verify RED**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/reader/page-data.test.ts tests/components/memory-reader-actions.test.ts tests/components/memory-reader-flashback-selection.test.ts
```

Expected: FAIL because translated reader currently uses projected source Flashbacks or source aggregate rows.

- [ ] **Step 4: Load active variant rows**

Update `src/server/reader/page-data.ts` to load active variant rows through the repository after content resolution. Remove the translated Flashback projection branch for normal reader rendering.

- [ ] **Step 5: Return variant identity to the component**

Map `variantKind`, `langCode`, and `translationOutputHash` into `ReaderFlashbackItem`. Keep `MemoryReader.tsx` state updates compatible with `payload.result.flashbacks`.

- [ ] **Step 6: Verify this slice**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/reader/page-data.test.ts tests/components/memory-reader-actions.test.ts tests/components/memory-reader-flashback-selection.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Reader pages are variant-local. The active reader route no longer imports source Flashbacks into translated content through projection.
