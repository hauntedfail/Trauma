# Task 19W.03: Toggle Service And API Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let translated reader selections create and remove translated Flashback rows directly, without source projection.

**Architecture:** The API already receives optional `langCode`. Source requests use source `CONTENT.md`; translated requests resolve the current translation, read translated `CONTENT.md`, scope rows by `langCode + outputHash`, and call the same range merge/split logic against translated reader text.

**Tech Stack:** SolidStart API route, existing `toggleMemoryFlashback`, translation current-state resolver, Vitest route/service tests.

---

## Role

Mutation owner.

This worker must not change browse UI or route list rendering.

## Files

- Modify: `src/routes/api/flashbacks.ts`
- Modify: `src/server/flashbacks/toggle.ts`
- Modify: `src/server/flashbacks/export.ts`
- Modify: `src/server/flashbacks/variant.ts`
- Test: `tests/server/routes/api-flashbacks-toggle.test.ts`
- Test: `tests/server/flashbacks/toggle.test.ts`

## Service Contract

Extend `ToggleMemoryFlashbackInput`:

```ts
variant?: FlashbackVariant;
content?: {
  markdown: string;
  relativePath: string;
};
```

Default is source:

```ts
const variant = input.variant ?? sourceFlashbackVariant;
```

Use:

```ts
const content = input.content ?? await readMemoryContent({
  config: { storePath: input.config.storePath },
  memoryId: input.memoryId,
});
```

Replace repository calls:

```ts
const existingFlashbacks =
  await repositories.flashbacks.listForMemoryVariant({
    memoryId: input.memoryId,
    variant,
  });
await repositories.flashbacks.replaceForMemoryVariant({
  memoryId: input.memoryId,
  variant,
  flashbacks: nextFlashbacks,
});
```

Every row built by `buildFlashbackRows` must include:

```ts
...toFlashbackVariantColumns(variant)
```

## API Contract

`POST /api/flashbacks` keeps the current payload shape:

```json
{
  "memoryId": "019e...",
  "langCode": "ja-JP",
  "operation": "flashback",
  "selection": {
    "text": "ジャン・ボードリヤール",
    "prefix": "あるいは、",
    "suffix": "が言ったように：",
    "startOffset": 5,
    "endOffset": 17
  }
}
```

Route behavior:

- no `langCode`: source variant,
- with `langCode`: resolve current translation,
- current translation missing/unavailable: HTTP 409 with `code: "translation_unavailable"`,
- current translation found: read translated `CONTENT.md`, pass translated Markdown and variant to `toggleMemoryFlashback`.

Remove these Flashback-specific projection imports from `src/routes/api/flashbacks.ts`:

```ts
projectFlashbacksToTranslatedReader
projectTranslatedSelectionToSourceReader
```

## Task Steps

- [ ] **Step 1: Replace projection test with variant-local test**

In `tests/server/routes/api-flashbacks-toggle.test.ts`, replace the current test named `"projects translated reader flashback selections back to source before saving"` with:

```ts
it("stores translated reader flashback selections as translated variant rows", async () => {
  const root = await makeRoot();
  const configPath = await writeConfig(root, { backupEnabled: false });
  process.env.TRAUMA_CONFIG_PATH = configPath;
  const config = loadTraumaConfig({ configPath });
  const sourceMarkdown = "Or as Jean Baudrillard has said:";
  const translatedMarkdown = "あるいは、ジャン・ボードリヤールが言ったように：";
  await seedTranslatedFlashbackFixture({
    config,
    sourceMarkdown,
    translatedMarkdown,
  });

  const selected = "ジャン・ボードリヤール";
  const startOffset = translatedMarkdown.indexOf(selected);
  const response = await POST(createApiEvent(new Request("http://localhost/api/flashbacks", {
    method: "POST",
    body: JSON.stringify({
      memoryId,
      langCode: "ja-JP",
      operation: "flashback",
      selection: {
        text: selected,
        prefix: translatedMarkdown.slice(0, startOffset),
        suffix: translatedMarkdown.slice(startOffset + selected.length),
        startOffset,
        endOffset: startOffset + selected.length,
      },
    }),
  })));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.result.flashbacks).toEqual([
    expect.objectContaining({
      text: selected,
      startOffset,
      endOffset: startOffset + selected.length,
    }),
  ]);

  const connection = initializeDatabase(config);
  try {
    expect(await connection.repositories.flashbacks.listForMemory(memoryId)).toEqual([]);
    const rows = connection.sqlite
      .prepare(
        "select text, variant_kind as variantKind, lang_code as langCode, translation_output_hash as translationOutputHash from flashbacks where memory_id = ? order by start_offset",
      )
      .all(memoryId);
    expect(rows).toEqual([
      expect.objectContaining({
        text: selected,
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
  } finally {
    connection.close();
  }
});
```

- [ ] **Step 2: Write direct toggle service test**

In `tests/server/flashbacks/toggle.test.ts`, call `toggleMemoryFlashback` with:

```ts
variant: {
  kind: "translation",
  langCode: "ja-JP",
  outputHash: "sha256:" + "a".repeat(64),
},
content: {
  markdown: "翻訳された本文です。",
  relativePath: `memories/${memoryId}/ja-JP/CONTENT.md`,
},
```

Assert source rows are untouched and translated rows are merged/split exactly like source rows.

- [ ] **Step 3: Verify RED**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/routes/api-flashbacks-toggle.test.ts tests/server/flashbacks/toggle.test.ts
```

Expected: FAIL because translated requests still project to source and the toggle service has no variant input.

- [ ] **Step 4: Implement translated content resolution in the route**

Add a helper in `src/routes/api/flashbacks.ts`:

```ts
async function resolveTranslatedFlashbackVariant(input: {
  config: ReturnType<typeof loadRuntimeTraumaConfig>;
  connection: ReturnType<typeof initializeDatabase>;
  langCode: SupportedLanguageCode;
  memoryId: string;
}) {
  const current = await resolveCurrentTranslationReadOnly({
    config: input.config,
    langCode: input.langCode,
    memoryId: input.memoryId,
    repository: input.connection.repositories.translations,
  });
  if (current.status !== "current") {
    throw new FlashbackToggleError(
      "Translated flashback selection is unavailable.",
      "stale_selection",
    );
  }
  const content = await readResolvedMemoryContent(
    resolveTranslatedMemoryContentPath({
      config: input.config,
      langCode: input.langCode,
      memoryId: input.memoryId,
    }),
  );
  return {
    content,
    variant: {
      kind: "translation" as const,
      langCode: input.langCode,
      outputHash: current.outputHash,
    },
  };
}
```

- [ ] **Step 5: Implement variant-aware toggle**

Update `toggleMemoryFlashback` and `buildFlashbackRows` with the contract above. Include `variantKind`, `langCode`, and `translationOutputHash` in returned Flashback items so frontend and delete actions can preserve variant identity.

- [ ] **Step 6: Verify this slice**

Run:

```sh
mise exec -- bun --bun x vitest run tests/server/routes/api-flashbacks-toggle.test.ts tests/server/flashbacks/toggle.test.ts tests/server/flashbacks/flashback-markers.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Translated Flashback API writes no longer depend on projection spans. Source and translated rows can be created independently through the same endpoint.
