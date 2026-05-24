# Task 19V.05: Cross-Variant Moment Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow translated reader headings and ToC rows to create or remove canonical source Moments.

**Architecture:** Moment identity remains source canonical. Translated reader payloads include the active language, and the server resolves the translated section to the source section by `sectionPath`, with anchor/title as validation signals when available.

**Tech Stack:** TypeScript, Solid component tests, SolidStart API route tests, existing Moment repository and reader ToC.

---

## Role

Moment mutation owner.

This worker must not change Flashback range projection or translation commit behavior.

## Files

- Modify: `src/components/reader/moment-requests.ts`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/routes/api/moments.ts`
- Modify: `src/server/moments/browse.ts`
- Test: `tests/server/routes/api-moments.test.ts`
- Test: `tests/components/reader-moment-actions.test.ts`
- Create: `tests/server/moments/browse.test.ts`
- Test: `tests/server/reader/page-data.test.ts`

## API Contract

Extend `POST /api/moments` payload:

```json
{
  "memoryId": "019e...",
  "langCode": "ja-JP",
  "sectionAnchor": "translated-anchor",
  "sectionTitle": "翻訳された見出し",
  "sectionLevel": 2,
  "sectionPath": "1/2",
  "sectionStartOffset": null,
  "sectionEndOffset": null,
  "contentHash": null
}
```

Source payloads omit `langCode`.

Resolution rules:

1. Source variant validates against source ToC exactly as today.
2. Translation variant validates the payload exists in translated ToC.
3. Translation variant finds exactly one source ToC entry with the same `sectionPath` and `sectionLevel`.
4. The row stored in `moments` uses source anchor, source title, source level, and source path.
5. If source path is missing or ambiguous, return 409 with `code: "ambiguous_projection"`.

## Task Steps

- [ ] **Step 1: Write Moment request tests**

Assert `createMomentForSection()` posts the active variant:

```ts
expect(await requests[0]?.json()).toMatchObject({
  langCode: "ja-JP",
  sectionPath: "1/2",
});
```

- [ ] **Step 2: Write translated API test**

Build source and translated Markdown with the same section path but different anchors/titles. Assert `POST /api/moments` from the translated heading stores the source section identity.

- [ ] **Step 3: Write ambiguous path test**

Build source Markdown where the translated `sectionPath` cannot resolve to exactly one source entry. Assert HTTP 409 with `code: "ambiguous_projection"`.

- [ ] **Step 4: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/routes/api-moments.test.ts tests/components/reader-moment-actions.test.ts tests/server/moments/browse.test.ts tests/server/reader/page-data.test.ts
```

Expected: FAIL because Moment API only validates against source payload identity.

- [ ] **Step 5: Extend frontend Moment payload**

In `MemoryReader.tsx`, pass the active translated language into `createMomentForSection()`. In `moment-requests.ts`, include `langCode` in the JSON body only for translated routes while keeping source behavior backward-compatible.

- [ ] **Step 6: Implement translated section resolution**

In `src/routes/api/moments.ts`:

- read source `CONTENT.md` and render source ToC,
- read translated `CONTENT.md` and render translated ToC when `langCode` is present,
- validate the translated payload against translated ToC,
- resolve source ToC by `sectionPath` and `sectionLevel`,
- store source section identity in SQLite.

- [ ] **Step 7: Keep browse links stable**

Update `src/server/moments/browse.ts` only if needed so Moment browse rows continue linking to source memory anchors by default. Do not make `/moments` language-specific in this workflow.

- [ ] **Step 8: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/routes/api-moments.test.ts tests/components/reader-moment-actions.test.ts tests/server/moments/browse.test.ts tests/server/reader/page-data.test.ts
mise exec -- bun run typecheck
```

Expected: tests and typecheck pass.

## Handoff

Translated Moment creation/removal now mutates canonical source Moment rows. Rendering active state on translated reader variants remains path-based and does not require language-specific Moment persistence.
