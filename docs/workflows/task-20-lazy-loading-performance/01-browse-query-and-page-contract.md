# Task 20.1: Browse Query and Page Contract

## Goal

Define the shared request and response contracts that allow `/memories` to ask
for one filtered page at a time without losing the current query semantics.

## Ownership

Primary files:

- Modify `src/components/memories/browse-data.ts`
- Modify `tests/memories/browse-data.test.ts`
- Modify `tests/components/browse-data-query.test.ts`

Do not change database access in this subtask.

## Contract

Add these exported types and helpers to `src/components/memories/browse-data.ts`
or a small adjacent module imported by that file:

- `BROWSE_MEMORY_PAGE_SIZE = 30`
- `BrowseMemoryCursor`
  - `createdAt: string`
  - `id: string`
- `BrowseMemoryPageRequest`
  - `query: BrowseQuery`
  - `cursor: BrowseMemoryCursor | null`
  - `limit: number`
- `BrowseMemoryPage`
  - `memories: BrowseMemory[]`
  - `nextCursor: BrowseMemoryCursor | null`
- `createInitialBrowseMemoryPageRequest(query: BrowseQuery)`
- `createNextBrowseMemoryPageRequest(query: BrowseQuery, cursor: BrowseMemoryCursor)`
- `isSameBrowseQuery(left: BrowseQuery, right: BrowseQuery)`

Keep `BrowseMemory` as the UI row type, but allow later subtasks to pass
`flashbacks: []` on initial rows. The absence of Flashback excerpts is a lazy
loading state, not a failed search state.

## Implementation Steps

1. Add failing tests that assert:
   - The first page request uses `BROWSE_MEMORY_PAGE_SIZE`, the parsed
     `BrowseQuery`, and a `null` cursor.
   - The next page request carries the cursor unchanged.
   - `isSameBrowseQuery` treats identical query values as equal and any changed
     `q`, `category`, `tag`, `flashback`, or `view` as different.
   - Existing parsing for `highlight` legacy parameters, read-state search
     tokens, fielded search, and ampersand field values still passes.

2. Implement only the contract helpers.

3. Run:

```bash
mise exec -- bun run test tests/memories/browse-data.test.ts tests/components/browse-data-query.test.ts
```

4. Commit with:

```bash
git add src/components/memories/browse-data.ts tests/memories/browse-data.test.ts tests/components/browse-data-query.test.ts
git commit -m "feat: define browse page contract"
```

## Acceptance Criteria

- Page request objects are serializable through SolidStart query arguments.
- Existing search and filter tests continue to pass unchanged except where they
  explicitly assert the new contract.
- No repository, route, or component fetch behaviour changes in this subtask.
