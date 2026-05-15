# 18.10 Flashback section bookmarks

## Goal

Add Flashback, TRAUMA's product name for section bookmarks.

Flashback lets a user save a reader section/chapter as a bookmark and later browse all saved Flashbacks at `/flashback`. Each Flashback item shows the bookmarked section and linked memory metadata. Clicking a Flashback navigates to the relevant memory and section anchor.

This subtask requires database design work. Do not model Flashback as browser local state or as markup inside `CONTENT.md`.

## Files likely owned

- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `src/server/reader/page-data.ts`
- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/route-state.ts`
- `src/components/reader/highlight-events.ts`
- `src/components/shell/AppShell.tsx`
- `src/routes/flashback/index.tsx`
- `src/routes/api/flashbacks.ts`
- `src/routes/api/flashbacks/[flashbackId].ts`
- optional `src/server/flashbacks/section-anchors.ts`
- optional `src/components/flashback/FlashbackBrowse.tsx`
- optional `src/components/reader/ReaderContextMenu.tsx`
- `tests/server/db/schema.test.ts`
- `tests/server/db/repositories.test.ts`
- `tests/server/routes/api-flashbacks.test.ts`
- `tests/server/reader/page-data.test.ts`
- `tests/components/reader-flashback-actions.test.tsx`
- `tests/components/flashback-route.test.tsx`

## Product contract

Route:

```text
/flashback
```

The `/flashback` page lists all Flashbacks.

Each Flashback row/card must include:

- section/chapter title
- source memory title
- source memory URL or display source
- created/saved timestamp
- enough section metadata to clarify where the Flashback points

Clicking a Flashback navigates to:

```text
/memories/:memoryId#<section-anchor>
```

If the anchor is stale or missing, navigate to the memory reader page and surface a non-blocking notice rather than failing the whole route.

## Data model contract

Add a `flashbacks` table.

Recommended schema:

```ts
flashbacks: {
  id: string;
  memoryId: string;
  sectionAnchor: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionPath: string;
  sectionStartOffset: number | null;
  sectionEndOffset: number | null;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- `memoryId` references `memories.id` with `onDelete: "cascade"`.
- A memory deletion deletes its Flashbacks.
- `sectionAnchor` is the reader anchor used for navigation.
- `sectionTitle` is the displayed chapter/section title at save time.
- `sectionLevel` is heading level where available.
- `sectionPath` identifies the section in the document outline, for example heading-index path or generated ToC path.
- `sectionStartOffset` and `sectionEndOffset` are canonical reader-text offsets for the section when available.
- `contentHash` is computed from canonical reader text or a section-anchor source hash when available.
- Do not write Flashback state to `CONTENT.md`.

Uniqueness:

- Prefer one Flashback per `(memoryId, sectionAnchor)` initially.
- Re-saving the same section should be idempotent and return the existing Flashback.
- If anchor generation can change, repository logic should detect an existing matching `sectionPath` before creating duplicates.

Indexing:

- Add an index on `memoryId` if needed for reader page lookups.
- Add an index on `createdAt` if `/flashback` lists by newest first.
- Do not add broad speculative indexes.

## Section identity and stale handling

Flashback attaches to reader sections/chapters, not arbitrary selected text.

Primary identity:

- `memoryId`
- `sectionAnchor`
- `sectionPath`

Staleness guards:

- `sectionTitle`
- optional section text offsets
- optional `contentHash`

Policy:

1. If the reader still has `sectionAnchor`, navigate to that anchor.
2. If the anchor is missing but `sectionPath` resolves uniquely, use the resolved section and update the stored anchor if safe.
3. If neither resolves uniquely, keep the Flashback row but mark it stale in UI.
4. Do not guess between multiple candidate sections with the same title/path ambiguity.

## API contract

### List Flashbacks

```http
GET /api/flashbacks
```

Response:

```json
{
  "flashbacks": [
    {
      "id": "flashback-id",
      "memoryId": "memory-id",
      "memoryTitle": "Memory title",
      "memoryUrl": "https://example.com/article",
      "sectionAnchor": "heading-anchor",
      "sectionTitle": "Chapter title",
      "sectionLevel": 2,
      "createdAt": "2026-05-14T00:00:00.000Z"
    }
  ]
}
```

### Create Flashback

```http
POST /api/flashbacks
content-type: application/json

{
  "memoryId": "memory-id",
  "sectionAnchor": "heading-anchor",
  "sectionTitle": "Chapter title",
  "sectionLevel": 2,
  "sectionPath": "0/3/1",
  "sectionStartOffset": 120,
  "sectionEndOffset": 480,
  "contentHash": "optional"
}
```

Responses:

- `201` when created
- `200` with `alreadyExists: true` when the Flashback already exists
- `400` for malformed payload
- `404` for missing memory

### Delete Flashback

```http
DELETE /api/flashbacks/:flashbackId
```

Responses:

- `204` when deleted
- `404` when missing

## Reader UI contract

Flashback can be set from a section/chapter in three ways:

1. Hover a ToC chapter row and show a Flashback icon at its left edge.
2. Hover a reader section heading and show a Flashback icon at its left edge.
3. Long-press a ToC chapter or reader section heading to open the same contextual menu component used for text selection; in heading mode, that menu includes a Flashback item.

Terminology:

- UI label should use `Flashback`.
- Icon may be a bookmark-shaped icon because the behaviour is bookmark-like.

Hover icon rules:

- The Flashback icon appears only when hovering a chapter/section affordance.
- The icon must not shift text layout when it appears.
- Clicking the icon creates the Flashback.
- If the section is already Flashbacked, render an active state.

Long-press/menu rules:

- Reuse the same contextual menu component used by reader text selection.
- Text-selection mode shows highlight actions only.
- Section-heading mode shows Flashback actions.
- Arbitrary body text selection must not show Flashback actions.
- A long-press on a heading opens the menu with `Flashback`.
- A long-press on a ToC row opens the menu with `Flashback`.

This means the menu component needs a mode or action-list input, for example:

```ts
type ReaderContextMenuMode =
  | { kind: "text-selection"; actions: ["highlight"] }
  | { kind: "section"; actions: ["flashback"] };
```

Do not fork two visually similar menu components.

## ToC contract

If the current reader already extracts a ToC/outline:

- extend that section model with Flashback metadata
- preserve existing anchors

If the current reader does not expose a stable ToC model:

- introduce a section model from sanitized reader headings
- generate stable anchors consistently with reader heading anchors
- use the same section model for ToC rendering and Flashback creation

Required section fields:

- `anchor`
- `title`
- `level`
- `path`
- optional `startOffset`
- optional `endOffset`

## `/flashback` route contract

Add a route:

```text
/flashback
```

Navigation:

- Add `Flashback` to the app shell navigation.

Rendering:

- List all Flashbacks newest first unless a later design specifies grouping.
- Show source memory title and section title.
- Clicking a row navigates to the reader section anchor.
- Provide an empty state when there are no Flashbacks.

Do not implement category/tag filters for Flashback in this subtask.

## Tests

Backend tests:

- migration creates `flashbacks`
- Flashback row references memory and cascades on memory deletion
- create Flashback succeeds
- create same `(memoryId, sectionAnchor)` is idempotent
- create missing memory returns `404`
- list Flashbacks includes memory metadata
- delete Flashback succeeds
- deleting a memory removes its Flashbacks

Reader/section tests:

- reader page data includes section metadata required by Flashback
- heading hover renders Flashback icon
- ToC hover renders Flashback icon
- clicking heading Flashback icon creates Flashback
- clicking ToC Flashback icon creates Flashback
- long-press heading opens contextual menu with Flashback action
- text selection contextual menu does not show Flashback action
- arbitrary body text long-press does not create a section Flashback

Route tests:

- `/flashback` lists all Flashbacks
- Flashback item links to `/memories/:memoryId#<section-anchor>`
- empty state renders when no Flashbacks exist

## Verification

```sh
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/db/repositories.test.ts
mise exec -- bun run test tests/server/routes/api-flashbacks.test.ts
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/components/reader-flashback-actions.test.tsx
mise exec -- bun run test tests/components/flashback-route.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- `/flashback` route exists.
- App navigation exposes Flashback.
- Flashbacks persist in SQLite.
- Flashbacks do not modify `CONTENT.md`.
- Flashbacks attach to sections/chapters only.
- ToC chapter hover exposes a Flashback icon.
- Reader section heading hover exposes a Flashback icon.
- Heading/ToC long-press opens the shared reader contextual menu with Flashback action.
- Ordinary text selection does not expose Flashback.
- Flashback list items navigate to the target memory section.
- Memory deletion cascades Flashbacks.

