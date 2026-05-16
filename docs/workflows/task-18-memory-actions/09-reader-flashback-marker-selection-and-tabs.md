# 18.9 Reader flashback selection and tabs

## Goal

Revise reader flashback interaction so text selection does not immediately create a flashback. A normal text selection should open a TRAUMA-owned contextual menu near the selection. Clicking the flashback icon in that menu creates the flashback.

Flashback persistence must remain record-based. Do not mutate `CONTENT.md` to store flashback marks.

## Files likely owned

- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/flashback-events.ts`
- `src/components/reader/flashback-failure.ts`
- `src/components/reader/route-state.ts`
- `src/server/flashbacks/toggle.ts`
- `src/server/flashbacks/ranges.ts`
- `src/server/store/flashback-markers.ts`
- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `src/routes/api/flashbacks.ts`
- `src/components/shell/AppShell.tsx`
- `src/components/flashbacks/flashbacks-loader.ts`
- `tests/server/flashbacks/toggle.test.ts`
- `tests/server/flashbacks/ranges.test.ts`
- `tests/server/flashbacks/flashback-markers.test.ts`
- `tests/server/routes/api-flashbacks-toggle.test.ts`
- `tests/components/memory-reader-flashback-selection.test.tsx`
- `tests/components/reader-flashback-tabs.test.tsx`

## Selection UX contract

Current behaviour creates/toggles a flashback directly from selected text. Replace that with explicit user intent:

1. User selects text normally in reader content.
2. TRAUMA renders a small contextual menu above or below the selected range.
3. The menu belongs to the app, not the browser context menu.
4. The menu contains a flashback icon action.
5. Clicking the flashback icon creates the flashback record for the selected range.
6. Clearing the selection, pressing Escape, scrolling away, or clicking outside closes the menu.

Menu positioning:

- Prefer above the selection.
- If there is not enough viewport space above, render below.
- Keep the menu within the viewport horizontally.
- Do not render the menu inside copied text or persisted content.

Accessibility:

- The flashback action is a real button.
- It has an accessible label, for example `Flashback selection`.
- Escape closes the menu.
- The menu must not trap focus permanently.

## Flashback record design

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
- `prefix` and `suffix` are display context for flashback-only rendering. They are not the primary anchor and must not be treated as sufficient disambiguation data.
- `contentHash` is recommended if the current schema does not already detect stale offset mappings.
- If adding `contentHash`, compute it from canonical reader text, not from the raw markdown file.
- Use `sha256:<hex>` as the `contentHash` format.
- Hash the UTF-8 bytes of the exact canonical reader text used for offset calculation.
- Normalize line endings to `\n` before both offset calculation and hashing.
- Do not trim leading/trailing text for hashing.
- Do not apply Unicode compatibility normalization for hashing unless the same
  normalization is also applied before offset calculation and rendering; if a
  Unicode normalization step is later introduced, document it beside the shared
  text-walker utility and keep one canonical implementation.
- If content hash mismatches later, do not silently apply a flashback to the wrong occurrence.

Canonical reader text:

- Derive it from the same reader content tree that users select from.
- Exclude app chrome, menus, buttons, route shell, and hidden controls.
- Normalize text consistently between selection mapping and flashback rendering.
- Prefer one shared text-walker utility so offset calculation and mark rendering cannot drift.

Why this disambiguates repeated text:

- If `foo` appears three times, all three records have `text = "foo"`.
- The selected occurrence is identified by its unique `startOffset` / `endOffset`.
- `contentHash` guards against applying offsets to a different content version.
- `prefix` and `suffix` stay available for recent-flashback rows and flashback-only rendering, but they are not used to choose between repeated identical occurrences.

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

1. When `contentHash` matches, apply the flashback by `startOffset` and `endOffset`.
2. Before rendering, verify that the canonical reader-text slice at the stored offsets equals `text`.
3. If the slice does not match, treat the flashback as stale and do not render it at a guessed location.
4. If `contentHash` changed, fallback re-anchoring may search by text/context only as a recovery mechanism.
5. Fallback re-anchoring may auto-apply only when it finds exactly one valid candidate.
6. If fallback finds multiple candidates, mark the flashback as ambiguous/stale and do not render it automatically.

This avoids silently rendering a flashback on the wrong occurrence. A missing/stale flashback is safer than a false flashback.

## Persistence contract

`CONTENT.md` must not be changed when creating, removing, or rendering flashbacks.

If existing code currently writes flashback marks back into markdown:

- Stop doing that for normal flashback persistence.
- Keep flashback rows in SQLite as the source of truth.
- Render flashback marks at read time by applying records to canonical reader text/HTML.
- Keep any markdown-marker utilities only if needed for migration, tests, or legacy compatibility.

Backup/export requirement:

- Do not rely on `CONTENT.md` mutation as the backup representation for new flashbacks.
- If the built-in git backup does not back up SQLite, add a metadata backup/export
  path for flashback rows before removing markdown marker writes from the normal
  flashback flow.
- The backup representation must be deterministic and restorable enough to
  preserve flashback records, including `memoryId`, `text`, offsets, guard
  context, and `contentHash`.
- Prefer a small metadata export file under the memory's backup scope, or a
  documented backup job that serializes flashback metadata with tests.
- If flashback metadata backup is intentionally deferred, the implementation PR
  must state the restore-risk explicitly and should not claim full backup
  parity for SQLite-only flashbacks.

## API contract

The existing flashback API may be reused, but its semantics must match explicit menu action.

Expected create/toggle payload:

```json
{
  "memoryId": "memory-id",
  "text": "selected text",
  "startOffset": 120,
  "endOffset": 133,
  "prefix": "before ",
  "suffix": " after",
  "contentHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

Validation:

- `memoryId` is a non-empty string.
- `text` is non-empty.
- offsets are non-negative integers.
- `endOffset > startOffset`.
- `text.length` matches the canonical slice when available.
- mismatched canonical slice returns a validation response and does not create a row.

Existing unflashback behaviour:

- Preserve existing flashback removal/toggle semantics if current tests depend on them.
- If the selected range exactly matches an existing flashback, the menu action may remove it only if that is the current product behaviour.
- Do not remove flashback deletion capability accidentally.

## Reader flashback tabs

The `/memories` recent flashback component stays unchanged.

Reader mode changes:

- In the reader-mode flashback component, render tabs under the component title.
- Left tab: all flashbacks across all memories.
- Second tab: flashbacks attached to the active memory only.

Labels:

- Left tab: `All flashbacks`
- Second tab: `This memory`

Default active tab:

- `This memory` when the current memory has flashbacks.
- `All flashbacks` when the current memory has no flashbacks.

Tab behaviour:

- Switching tabs does not navigate away from the reader page.
- `All flashbacks` rows can navigate to their owning memory/flashback anchor.
- `This memory` rows navigate within the current reader page.
- Empty state for `This memory`: show a concise hint that no flashbacks exist for this memory.
- Empty state for `All flashbacks`: show the existing no-flashbacks empty state.

## Tests

Selection/menu tests:

- selecting text renders the custom flashback menu
- flashback is not created until the icon is clicked
- Escape closes the menu
- clicking outside closes the menu
- repeated selected text creates a record for the selected occurrence by offset
- stale/mismatched offset validation does not create a flashback

Persistence tests:

- creating a flashback inserts/updates flashback records only
- creating a flashback does not modify `CONTENT.md`
- removing a flashback does not modify `CONTENT.md`
- existing flashback rendering still works from SQLite rows
- flashback metadata is exported or queued for backup when SQLite is not backed up directly
- restore-risk is documented if metadata backup is deliberately deferred

Record tests:

- duplicate selected text with different offsets creates distinct records
- `contentHash` uses `sha256:<hex>` from the same canonical reader text used for offsets
- line-ending normalization is consistent between hash creation and validation
- overlapping ranges continue to follow existing range rules
- exact existing flashback selection preserves existing toggle/remove semantics if supported

Reader tab tests:

- `/memories` recent flashback component remains unchanged
- reader flashback component renders `All flashbacks` as the left tab
- reader flashback component renders `This memory` as the second tab
- `This memory` tab only lists flashbacks for the active memory
- `All flashbacks` tab lists flashbacks across memories
- default tab follows the contract above

## Verification

```sh
mise exec -- bun run test tests/server/flashbacks/toggle.test.ts
mise exec -- bun run test tests/server/flashbacks/ranges.test.ts
mise exec -- bun run test tests/server/flashbacks/flashback-markers.test.ts
mise exec -- bun run test tests/server/routes/api-flashbacks-toggle.test.ts
mise exec -- bun run test tests/components/memory-reader-flashback-selection.test.tsx
mise exec -- bun run test tests/components/reader-flashback-tabs.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Selecting reader text opens a custom TRAUMA flashback menu.
- Flashback records are created only after clicking the flashback icon.
- Flashback persistence does not mutate `CONTENT.md`.
- Repeated text selections are disambiguated by canonical offsets.
- Existing flashback rendering remains available.
- `/memories` recent flashbacks remain unchanged.
- Reader mode has `All flashbacks` left tab and `This memory` second tab.
- Reader current-memory tab lists only active-memory flashbacks.
