# Task 19W.02: Repository And Variant Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small Flashback variant domain and repository methods that can list and replace only one variant without deleting rows from another variant.

**Architecture:** Keep legacy source helpers as wrappers, then add variant-aware methods used by translated flows. Repository replacement is scoped by `(memory_id, variant_kind, lang_code, translation_output_hash)`.

**Tech Stack:** TypeScript, Drizzle repositories, Vitest repository tests.

---

## Role

Repository owner.

This worker must not change Solid components or route rendering.

## Files

- Create: `src/server/flashbacks/variant.ts`
- Modify: `src/server/db/repositories.ts`
- Modify: `src/server/flashbacks/index.ts`
- Test: `tests/server/flashbacks/repository.test.ts`
- Test: `tests/server/db/repositories.test.ts`

## Domain Type

Create `src/server/flashbacks/variant.ts`:

```ts
import type { SupportedLanguageCode } from "../translation/languages";

export type FlashbackVariant =
  | { kind: "source" }
  | {
      kind: "translation";
      langCode: SupportedLanguageCode;
      outputHash: string;
    };

export interface FlashbackVariantColumns {
  variantKind: "source" | "translation";
  langCode: SupportedLanguageCode | null;
  translationOutputHash: string | null;
}

export const sourceFlashbackVariant: FlashbackVariant = { kind: "source" };

export function toFlashbackVariantColumns(
  variant: FlashbackVariant,
): FlashbackVariantColumns {
  if (variant.kind === "source") {
    return {
      variantKind: "source",
      langCode: null,
      translationOutputHash: null,
    };
  }

  return {
    variantKind: "translation",
    langCode: variant.langCode,
    translationOutputHash: variant.outputHash,
  };
}
```

## Repository Contract

Extend `FlashbackRepository`:

```ts
listForMemoryVariant: (
  input: { memoryId: string; variant: FlashbackVariant },
) => Promise<Flashback[]>;
replaceForMemoryVariant: (
  input: {
    memoryId: string;
    variant: FlashbackVariant;
    flashbacks: Flashback[];
  },
) => Promise<Flashback[]>;
```

Keep existing wrappers:

```ts
listForMemory: (memoryId) =>
  repositories.flashbacks.listForMemoryVariant({
    memoryId,
    variant: sourceFlashbackVariant,
  }),
replaceForMemory: (memoryId, flashbacks) =>
  repositories.flashbacks.replaceForMemoryVariant({
    memoryId,
    variant: sourceFlashbackVariant,
    flashbacks,
  }),
```

`replaceForMemoryVariant` must delete only rows matching the exact variant columns:

```ts
and(
  eq(schema.flashbacks.memoryId, memoryId),
  eq(schema.flashbacks.variantKind, columns.variantKind),
  columns.langCode === null
    ? isNull(schema.flashbacks.langCode)
    : eq(schema.flashbacks.langCode, columns.langCode),
  columns.translationOutputHash === null
    ? isNull(schema.flashbacks.translationOutputHash)
    : eq(schema.flashbacks.translationOutputHash, columns.translationOutputHash),
)
```

Import `isNull` from `drizzle-orm`.

## Task Steps

- [ ] **Step 1: Write variant replacement test**

In `tests/server/flashbacks/repository.test.ts`, seed one source row and one translated row for the same memory. Call `replaceForMemoryVariant({ variant: { kind: "source" } })`. Assert the translated row remains.

Expected final row ids:

```ts
expect(rows.map((row) => row.id)).toEqual([
  "source-new",
  "translated-existing",
]);
```

- [ ] **Step 2: Write translated replacement test**

Seed two translated rows for the same memory:

```ts
{ langCode: "ja-JP", translationOutputHash: "sha256:" + "a".repeat(64) }
{ langCode: "ja-JP", translationOutputHash: "sha256:" + "b".repeat(64) }
```

Replace only the first output hash and assert the second output hash row remains.

- [ ] **Step 3: Verify RED**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/flashbacks/repository.test.ts tests/server/db/repositories.test.ts
```

Expected: FAIL because `listForMemoryVariant` and `replaceForMemoryVariant` do not exist.

- [ ] **Step 4: Add variant domain file**

Create `src/server/flashbacks/variant.ts` with the type and conversion helpers above. Export it through `src/server/flashbacks/index.ts`.

- [ ] **Step 5: Implement repository methods**

Update `src/server/db/repositories.ts` to:

- include `variantKind`, `langCode`, and `translationOutputHash` in `FlashbackBrowseRow`,
- add variant-aware list and replace methods,
- keep legacy wrappers source-scoped,
- validate every replacement row has the same memory and same variant columns as the requested variant.

Validation failure message:

```ts
"Cannot replace flashbacks for one memory variant with rows from another memory variant."
```

- [ ] **Step 6: Verify this slice**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/flashbacks/repository.test.ts tests/server/db/repositories.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

The repository can safely replace one Flashback variant without deleting source rows, translated rows, or rows tied to a different translation output hash.
