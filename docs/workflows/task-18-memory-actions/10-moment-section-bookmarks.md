# 18.10 Moment section bookmarks

## Goal

Add Moment, TRAUMA's product name for section bookmarks.

Moment lets a user save a reader section/chapter as a bookmark and later browse all saved Moments at `/moments`. Each Moment item shows the bookmarked section and linked memory metadata. Clicking a Moment navigates to the relevant memory and section anchor.

This subtask requires database design work. Do not model Moment as browser local state or as markup inside `CONTENT.md`.

## Files likely owned

- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `src/server/reader/page-data.ts`
- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/route-state.ts`
- `src/components/reader/flashback-events.ts`
- `src/components/shell/AppShell.tsx`
- `src/routes/moments/index.tsx`
- `src/routes/api/moments.ts`
- `src/routes/api/moments/[momentId].ts`
- optional `src/server/moments/section-anchors.ts`
- optional `src/components/moments/MomentBrowse.tsx`
- optional `src/components/reader/ReaderContextMenu.tsx`
- `tests/server/db/schema.test.ts`
- `tests/server/db/repositories.test.ts`
- `tests/server/routes/api-moments.test.ts`
- `tests/server/reader/page-data.test.ts`
- `tests/components/reader-moment-actions.test.tsx`
- `tests/components/moment-route.test.tsx`

## Product contract

Route:

```text
/moments
```

The `/moments` page lists all Moments.

Each Moment row/card must include:

- section/chapter title
- source memory title
- source memory URL or display source
- created/saved timestamp
- enough section metadata to clarify where the Moment points

Clicking a Moment navigates to:

```text
/memories/:memoryId#<section-anchor>
```

If the anchor is stale or missing, navigate to the memory reader page and surface a non-blocking notice rather than failing the whole route.

## Data model contract

Add a `moments` table.

Recommended schema:

```ts
moments: {
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
- A memory deletion deletes its Moments.
- `sectionAnchor` is the reader anchor used for navigation.
- `sectionTitle` is the displayed chapter/section title at save time.
- `sectionLevel` is heading level where available.
- `sectionPath` identifies the section in the document outline, for example heading-index path or generated ToC path.
- `sectionStartOffset` and `sectionEndOffset` are canonical reader-text offsets for the section when available.
- `contentHash` is computed from canonical reader text or a section-anchor source hash when available.
- Do not write Moment state to `CONTENT.md`.

Uniqueness:

- Prefer one Moment per `(memoryId, sectionAnchor)` initially.
- Re-saving the same section should be idempotent and return the existing Moment.
- If anchor generation can change, repository logic should detect an existing matching `sectionPath` before creating duplicates.

Indexing:

- Add an index on `memoryId` if needed for reader page lookups.
- Add an index on `createdAt` if `/moment` lists by newest first.
- Do not add broad speculative indexes.

## Section identity and stale handling

Moment attaches to reader sections/chapters, not arbitrary selected text.

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
3. If neither resolves uniquely, keep the Moment row but mark it stale in UI.
4. Do not guess between multiple candidate sections with the same title/path ambiguity.

## API contract

### List Moments

```http
GET /api/moments
```

Response:

```json
{
  "moments": [
    {
      "id": "moment-id",
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

### Create Moment

```http
POST /api/moments
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
- `200` with `alreadyExists: true` when the Moment already exists
- `400` for malformed payload
- `400` when the supplied section does not resolve uniquely in the memory reader section model
- `404` for missing memory

Server validation:

- Do not trust client-supplied `sectionAnchor`, `sectionTitle`, `sectionPath`,
  or offsets as proof that a valid section exists.
- The create route must load the target memory's reader section model before
  insertion.
- The route must verify that the supplied section identity resolves uniquely for
  the memory.
- Prefer validating by `sectionAnchor` first, then by `sectionPath`; use title
  and offsets as guards, not as sufficient identity on their own.
- Reject the request if the section is missing, ambiguous, or belongs to a
  different memory.
- Store normalized section metadata from the server-resolved section, not
  blindly from the request body.

### Delete Moment

```http
DELETE /api/moments/:momentId
```

Responses:

- `204` when deleted
- `404` when missing

## Reader UI contract

Moment can be set from a section/chapter in three ways:

1. Hover a ToC chapter row and show a Moment icon at its left edge.
2. Hover a reader section heading and show a Moment icon at its left edge.
3. Long-press a ToC chapter or reader section heading to open the same contextual menu component used for text selection; in heading mode, that menu includes a Moment item.

Terminology:

- UI label should use `Moment`.
- Icon may be a bookmark-shaped icon because the behaviour is bookmark-like.

Hover icon rules:

- The Moment icon appears only when hovering a chapter/section affordance.
- The icon must not shift text layout when it appears.
- Clicking the icon creates the Moment.
- If the section is already Momented, render an active state.

Long-press/menu rules:

- Reuse the same contextual menu component used by reader text selection.
- Text-selection mode shows Flashback actions only.
- Section-heading mode shows Moment actions.
- Arbitrary body text selection must not show Moment actions.
- A long-press on a heading opens the menu with `Moment`.
- A long-press on a ToC row opens the menu with `Moment`.

This means the menu component needs a mode or action-list input, for example:

```ts
type ReaderContextMenuMode =
  | { kind: "text-selection"; actions: ["flashback"] }
  | { kind: "section"; actions: ["moment"] };
```

Do not fork two visually similar menu components.

## ToC contract

If the current reader already extracts a ToC/outline:

- extend that section model with Moment metadata
- preserve existing anchors

If the current reader does not expose a stable ToC model:

- introduce a section model from sanitized reader headings
- generate stable anchors consistently with reader heading anchors
- use the same section model for ToC rendering and Moment creation

Required section fields:

- `anchor`
- `title`
- `level`
- `path`
- optional `startOffset`
- optional `endOffset`

## `/moment` route contract

Add a route:

```text
/moment
```

Navigation:

- Add `Moment` to the app shell navigation.

Rendering:

- List all Moments newest first unless a later design specifies grouping.
- Show source memory title and section title.
- Clicking a row navigates to the reader section anchor.
- Provide an empty state when there are no Moments.

Do not implement category/tag filters for Moment in this subtask.

## Tests

Backend tests:

- migration creates `moments`
- Moment row references memory and cascades on memory deletion
- create Moment succeeds
- create same `(memoryId, sectionAnchor)` is idempotent
- create missing memory returns `404`
- create missing or ambiguous section identity returns `400`
- create stores server-resolved section metadata rather than blindly trusting the request body
- list Moments includes memory metadata
- delete Moment succeeds
- deleting a memory removes its Moments

Reader/section tests:

- reader page data includes section metadata required by Moment
- heading hover renders Moment icon
- ToC hover renders Moment icon
- clicking heading Moment icon creates Moment
- clicking ToC Moment icon creates Moment
- long-press heading opens contextual menu with Moment action
- text selection contextual menu does not show Moment action
- arbitrary body text long-press does not create a section Moment

Route tests:

- `/moment` lists all Moments
- Moment item links to `/memories/:memoryId#<section-anchor>`
- empty state renders when no Moments exist

## Verification

```sh
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/db/repositories.test.ts
mise exec -- bun run test tests/server/routes/api-moments.test.ts
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/components/reader-moment-actions.test.tsx
mise exec -- bun run test tests/components/moment-route.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- `/moment` route exists.
- App navigation exposes Moment.
- Moments persist in SQLite.
- Moments do not modify `CONTENT.md`.
- Moments attach to sections/chapters only.
- ToC chapter hover exposes a Moment icon.
- Reader section heading hover exposes a Moment icon.
- Heading/ToC long-press opens the shared reader contextual menu with Moment action.
- Ordinary text selection does not expose Moment.
- Moment list items navigate to the target memory section.
- Memory deletion cascades Moments.
