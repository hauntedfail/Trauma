# 18.9 Reader highlight selection and tabs

## Goal

Revise reader highlight interaction so text selection does not immediately create a highlight. A normal text selection should open a TRAUMA-owned contextual menu near the selection. Clicking the highlight icon in that menu creates the highlight.

Highlight persistence must remain record-based. Do not mutate `CONTENT.md` to store highlight marks.

## Files likely owned

- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/highlight-events.ts`
- `src/components/reader/highlight-failure.ts`
- `src/components/reader/route-state.ts`
- `src/server/highlights/toggle.ts`
- `src/server/highlights/ranges.ts`
- `src/server/store/highlight-markers.ts`
- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `src/routes/api/highlights.ts`
- `src/components/shell/AppShell.tsx`
- `src/components/highlights/highlights-loader.ts`
- `tests/server/highlights/toggle.test.ts`
- `tests/server/highlights/ranges.test.ts`
- `tests/server/highlights/highlight-markers.test.ts`
- `tests/server/routes/api-highlights.test.ts`
- `tests/components/memory-reader-highlight-selection.test.tsx`
- `tests/components/reader-highlight-tabs.test.tsx`

## Selection UX contract

Current behaviour creates/toggles a highlight directly from selected text. Replace that with explicit user intent:

1. User selects text normally in reader content.
2. TRAUMA renders a small contextual menu above or below the selected range.
3. The menu belongs to the app, not the browser context menu.
4. The menu contains a highlight icon action.
5. Clicking the highlight icon creates the highlight record for the selected range.
6. Clearing the selection, pressing Escape, scrolling away, or clicking outside closes the menu.

Menu positioning:

- Prefer above the selection.
- If there is not enough viewport space above, render below.
- Keep the menu within the viewport horizontally.
- Do not render the menu inside copied text or persisted content.

Accessibility:

- The highlight action is a real button.
- It has an accessible label, for example `Highlight selection`.
- Escape closes the menu.
- The menu must not trap focus permanently.

## Highlight record design

Selected text alone is not enough. A word or sentence may appear multiple times in the same content.

Use canonical reader-text offsets as the primary identity:

```ts
{
  id: string;
  memoryId: string;
  text: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  contentHash?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- `startOffset` and `endOffset` are offsets into canonical reader text, not into raw markdown and not into DOM HTML.
- Offsets are the primary mechanism that distinguishes repeated words.
- `text` stores the exact selected text for display and validation.
- `prefix` and `suffix` are display context for highlight-only rendering. They are not the primary anchor and must not be treated as sufficient disambiguation data.
- `contentHash` is recommended if the current schema does not already detect stale offset mappings.
- If adding `contentHash`, compute it from canonical reader text, not from the raw markdown file.
- If content hash mismatches later, do not silently apply a highlight to the wrong occurrence.

Canonical reader text:

- Derive it from the same reader content tree that users select from.
- Exclude app chrome, menus, buttons, route shell, and hidden controls.
- Normalize text consistently between selection mapping and highlight rendering.
- Prefer one shared text-walker utility so offset calculation and mark rendering cannot drift.

Why this disambiguates repeated text:

- If `foo` appears three times, all three records have `text = "foo"`.
- The selected occurrence is identified by its unique `startOffset` / `endOffset`.
- `contentHash` guards against applying offsets to a different content version.
- `prefix` and `suffix` stay available for recent-highlight rows and highlight-only rendering, but they are not used to choose between repeated identical occurrences.

Do not use occurrence index as the primary identity. It is fragile when nearby content changes.

## Ambiguous repeated text policy

`prefix` and `suffix` cannot disambiguate repeated text when the repeated selection and its surrounding context are identical.

Example:

```text
雨降る日のこと。 ... 雨降る日のこと。
   ^ selected 日        ^ identical 日
```

If the selected text is `日`, both occurrences can have the same:

- `text`
- `prefix`
- `suffix`
- surrounding sentence
- broader surrounding paragraph

The correct policy is:

1. When `contentHash` matches, apply the highlight by `startOffset` and `endOffset`.
2. Before rendering, verify that the canonical reader-text slice at the stored offsets equals `text`.
3. If the slice does not match, treat the highlight as stale and do not render it at a guessed location.
4. If `contentHash` changed, fallback re-anchoring may search by text/context only as a recovery mechanism.
5. Fallback re-anchoring may auto-apply only when it finds exactly one valid candidate.
6. If fallback finds multiple candidates, mark the highlight as ambiguous/stale and do not render it automatically.

This avoids silently rendering a highlight on the wrong occurrence. A missing/stale highlight is safer than a false highlight.

## Persistence contract

`CONTENT.md` must not be changed when creating, removing, or rendering highlights.

If existing code currently writes highlight marks back into markdown:

- Stop doing that for normal highlight persistence.
- Keep highlight rows in SQLite as the source of truth.
- Render highlight marks at read time by applying records to canonical reader text/HTML.
- Keep any markdown-marker utilities only if needed for migration, tests, or legacy compatibility.

## API contract

The existing highlight API may be reused, but its semantics must match explicit menu action.

Expected create/toggle payload:

```json
{
  "memoryId": "memory-id",
  "text": "selected text",
  "startOffset": 120,
  "endOffset": 133,
  "prefix": "before ",
  "suffix": " after",
  "contentHash": "optional-canonical-text-hash"
}
```

Validation:

- `memoryId` is a non-empty string.
- `text` is non-empty.
- offsets are non-negative integers.
- `endOffset > startOffset`.
- `text.length` matches the canonical slice when available.
- mismatched canonical slice returns a validation response and does not create a row.

Existing unhighlight behaviour:

- Preserve existing highlight removal/toggle semantics if current tests depend on them.
- If the selected range exactly matches an existing highlight, the menu action may remove it only if that is the current product behaviour.
- Do not remove highlight deletion capability accidentally.

## Reader highlight tabs

The `/memories` recent highlight component stays unchanged.

Reader mode changes:

- In the reader-mode highlight component, render tabs under the component title.
- Left tab: all highlights across all memories.
- Second tab: highlights attached to the active memory only.

Labels:

- Left tab: `All highlights`
- Second tab: `This memory`

Default active tab:

- `This memory` when the current memory has highlights.
- `All highlights` when the current memory has no highlights.

Tab behaviour:

- Switching tabs does not navigate away from the reader page.
- `All highlights` rows can navigate to their owning memory/highlight anchor.
- `This memory` rows navigate within the current reader page.
- Empty state for `This memory`: show a concise hint that no highlights exist for this memory.
- Empty state for `All highlights`: show the existing no-highlights empty state.

## Tests

Selection/menu tests:

- selecting text renders the custom highlight menu
- highlight is not created until the icon is clicked
- Escape closes the menu
- clicking outside closes the menu
- repeated selected text creates a record for the selected occurrence by offset
- stale/mismatched offset validation does not create a highlight

Persistence tests:

- creating a highlight inserts/updates highlight records only
- creating a highlight does not modify `CONTENT.md`
- removing a highlight does not modify `CONTENT.md`
- existing highlight rendering still works from SQLite rows

Record tests:

- duplicate selected text with different offsets creates distinct records
- overlapping ranges continue to follow existing range rules
- exact existing highlight selection preserves existing toggle/remove semantics if supported

Reader tab tests:

- `/memories` recent highlight component remains unchanged
- reader highlight component renders `All highlights` as the left tab
- reader highlight component renders `This memory` as the second tab
- `This memory` tab only lists highlights for the active memory
- `All highlights` tab lists highlights across memories
- default tab follows the contract above

## Verification

```sh
mise exec -- bun run test tests/server/highlights/toggle.test.ts
mise exec -- bun run test tests/server/highlights/ranges.test.ts
mise exec -- bun run test tests/server/highlights/highlight-markers.test.ts
mise exec -- bun run test tests/server/routes/api-highlights.test.ts
mise exec -- bun run test tests/components/memory-reader-highlight-selection.test.tsx
mise exec -- bun run test tests/components/reader-highlight-tabs.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Selecting reader text opens a custom TRAUMA highlight menu.
- Highlight records are created only after clicking the highlight icon.
- Highlight persistence does not mutate `CONTENT.md`.
- Repeated text selections are disambiguated by canonical offsets.
- Existing highlight rendering remains available.
- `/memories` recent highlights remain unchanged.
- Reader mode has `All highlights` left tab and `This memory` second tab.
- Reader current-memory tab lists only active-memory highlights.
