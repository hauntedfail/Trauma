# Task 20.2: SQLite Repository Pagination

## Goal

Move memory browse filtering and pagination into SQLite so the server never has
to load the full archive for `/memories`.

## Ownership

Primary files:

- Modify `src/server/db/schema.ts`
- Create `drizzle/0015_memory_browse_pagination.sql`
- Modify `src/server/db/bundled-migrations.ts`
- Modify `src/server/db/repositories.ts`
- Modify `tests/server/db/schema.test.ts`
- Modify `tests/server/db/repositories.test.ts`

Do not change `src/components/memories/MemoryBrowse.tsx` in this subtask.

## Repository Contract

Add a repository method for page loading. Keep `listForBrowse()` temporarily as
a compatibility method with its current Flashback-inclusive shape until later
subtasks finish replacing callers.

```ts
listForBrowsePage: (input: {
  categoryId: string;
  cursor: { createdAt: Date; id: string } | null;
  flashbackId: string;
  limit: number;
  readState: "all" | "both" | "read" | "unread";
  searchFields: {
    field: "title" | "url" | "tag" | "category" | "flashback";
    values: string[];
  }[];
  searchTerms: string[];
  tagId: string;
}) => Promise<{
  rows: MemoryBrowsePageRow[];
  nextCursor: { createdAt: Date; id: string } | null;
}>;
```

Add `MemoryBrowsePageRow` for page results. It must include memory metadata,
categories, and tags. It must not include nested Flashbacks. Keep
`MemoryBrowseRow` as the legacy Flashback-inclusive type until callers are
migrated.

## Query Semantics

- Sort by `memories.created_at desc, memories.id desc`.
- Use `limit + 1` rows to decide `nextCursor`.
- Cursor predicate:
  - `created_at < cursor.createdAt`
  - or `created_at = cursor.createdAt and id < cursor.id`
- `readState = "both"` returns an empty page.
- Explicit `categoryId` and `tagId` use archive-wide AND semantics.
- Explicit `flashbackId` uses an `exists` filter on `flashbacks.id`.
- Free search terms match any of:
  - memory title
  - memory URL
  - memory description
  - category name
  - tag name
  - Flashback text, prefix, or suffix
- Fielded search terms preserve current field names:
  - `title`
  - `url`
  - `tag`
  - `category`
  - `flashback`
- Multiple values in the same field filter keep the current AND semantics.
- SQL string matching must escape `%`, `_`, and `\` before using `LIKE`.

## Index and Migration

Add a composite index that supports the cursor order:

```ts
index("memories_created_at_id_idx").on(table.createdAt, table.id)
```

Add the bundled migration and a schema test that proves the index exists after
runtime migration.

## Implementation Steps

1. Add repository tests with at least five memories sharing mixed created times,
   categories, tags, read state, and Flashbacks. Assert:
   - first page ordering;
   - second page cursor continuation;
   - stable ordering for identical `createdAt`;
   - `read`, `unread`, and `read + unread` behaviour;
   - explicit category/tag filters;
   - explicit Flashback ID filter;
   - free search matching category/tag/Flashback metadata outside the first
     page;
   - escaped LIKE characters match literally.

2. Add the schema index and bundled migration.

3. Implement `listForBrowsePage()` using Drizzle query builders and `sql`
   fragments only where needed for cursor and `exists` predicates.

4. Keep the existing `listForBrowse()` implementation intact for compatibility
   until Task 20.3 and Task 20.4 replace production route usage. Do not make
   `listForBrowse()` call `listForBrowsePage()` unless it preserves the old
   Flashback-inclusive return shape.

5. Run:

```bash
mise exec -- bun run test tests/server/db/schema.test.ts tests/server/db/repositories.test.ts
```

6. Commit with:

```bash
git add drizzle/0015_memory_browse_pagination.sql src/server/db/schema.ts src/server/db/bundled-migrations.ts src/server/db/repositories.ts tests/server/db/schema.test.ts tests/server/db/repositories.test.ts
git commit -m "feat: paginate memory browse queries"
```

## Acceptance Criteria

- Repository pagination never loads nested Flashbacks for memory page rows.
- Search and filters apply before pagination.
- Cursor pages are deterministic when multiple memories have the same
  `createdAt`.
- Existing callers of `listForBrowse()` still receive the old
  Flashback-inclusive shape until replaced.
