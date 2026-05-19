# 18.1 Data model and repository foundation

## Goal

Create the backend foundation for read status, taxonomy records, taxonomy assignment, taxonomy list ordering, and memory deletion metadata. This subtask does not implement public API routes or UI.

## Files likely owned

- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- optional `src/server/taxonomy/id.ts`
- `tests/server/db/schema.test.ts`
- `tests/server/db/repositories.test.ts`

## Data model contract

Add `read` to `memories`:

```ts
read: integer("read", { mode: "boolean" }).notNull().default(false)
```

Rules:

- Existing rows migrate to `false`.
- New rows default to `false`.
- No index for `read`.
- Keep the TypeScript property name `read`.
- Keep SQL column name `read` unless actual SQLite/Drizzle evidence proves that unsafe.

Review existing taxonomy schema before editing:

- `tags`
- `categories`
- `memory_tags`
- `memory_categories`

Default design:

- Keep many-to-many join tables.
- Keep unique names.
- Do not add taxonomy columns unless repository queries cannot satisfy required ordering.
- Use join-table `createdAt` / `updatedAt` as assignment activity timestamps.
- Do not put tags/categories into `CONTENT.md` frontmatter.

ID rule:

- Do not derive tag/category IDs from display names.
- Use a generated stable ID so later rename support does not require primary-key migration.
- If adding a generator, keep it taxonomy-specific rather than reusing memory ID semantics accidentally.

## Repository contract

Extend repositories with focused methods.

Memory:

```ts
setReadStatus(input: { memoryId: string; read: boolean; updatedAt: Date }): Promise<Memory | undefined>
findDeletionTarget(memoryId: string): Promise<{ id: string; contentPath: string } | undefined>
deleteMemoryRecord(memoryId: string): Promise<boolean>
```

Taxonomy:

```ts
createTag(input: { id: string; name: string; now: Date }): Promise<Tag>
createCategory(input: { id: string; name: string; now: Date }): Promise<Category>
findTagByName(name: string): Promise<Tag | undefined>
findCategoryByName(name: string): Promise<Category | undefined>
attachTagToMemory(input: { memoryId: string; tagId: string; now: Date }): Promise<void>
attachCategoryToMemory(input: { memoryId: string; categoryId: string; now: Date }): Promise<void>
listTagsForBrowse(): Promise<TaxonomyBrowseRow[]>
listCategoriesForBrowse(): Promise<TaxonomyBrowseRow[]>
```

`TaxonomyBrowseRow`:

```ts
{
  id: string;
  name: string;
  memoryCount: number;
  lastAssignedAt: string | null;
}
```

Repository rules:

- Attach operations are idempotent.
- Attach operations update assignment activity timestamps when an existing relation is reattached.
- Missing memory/tag/category is reported explicitly, not silently ignored.
- `listTagsForBrowse()` and `listCategoriesForBrowse()` include records with zero attached memories.
- Sorting is `memoryCount desc`, `lastAssignedAt desc`, `name asc`.
- Deleting a memory record relies on SQLite foreign-key cascades for Flashbacks, Moments, and join rows.
- Deleting a memory record does not delete global tag/category rows.

## Query shape changes

Update browse and reader DTO sources so later UI subtasks can consume:

- `read`
- `extractionStatus`
- attached `tags`
- attached `categories`

Do not implement rendering in this subtask.

## Tests

Cover:

- migration adds `read` defaulting to false for existing rows
- repository-created memories default unread when no explicit value is supplied
- `setReadStatus()` toggles true and false
- tag/category creation succeeds
- duplicate tag/category names return or preserve a single canonical row according to repository contract
- attach tag/category to memory succeeds
- attach is idempotent and updates assignment activity
- taxonomy list includes zero-count records
- taxonomy sorting follows count, recent assignment, name
- memory delete record cascades Flashbacks, Moments, and join rows
- memory delete record keeps global tag/category rows

## Verification

Run focused backend tests for this slice:

```sh
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/db/repositories.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Database migration is minimal and reversible through normal project migration flow.
- Repository methods expose all data needed by later API/UI subtasks.
- No UI or route behaviour is introduced here.
- No tags/categories are written to content markdown.

