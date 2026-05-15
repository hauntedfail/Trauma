# 18.2 API and mutation service layer

## Goal

Expose read status, taxonomy creation, taxonomy assignment, and memory deletion through server routes/services. This subtask should not implement visual UI.

## Files likely owned

- `src/routes/api/memories/read-status.ts`
- `src/routes/api/memories/[memoryId].ts`
- `src/routes/api/memories/tags.ts`
- `src/routes/api/memories/categories.ts`
- `src/routes/api/tags.ts`
- `src/routes/api/categories.ts`
- optional `src/server/memories/delete-memory.ts`
- optional `src/server/taxonomy/mutations.ts`
- `src/server/store/memory-content.ts`
- `tests/server/routes/api-memory-read-status.test.ts`
- `tests/server/routes/api-memory-delete.test.ts`
- `tests/server/routes/api-taxonomy.test.ts`

## API contract

### Read status

```http
POST /api/memories/read-status
content-type: application/json

{
  "memoryId": "memory-id",
  "read": true
}
```

Responses:

- `200` with `{ "memoryId": string, "read": boolean }`
- `400` malformed payload
- `404` missing memory

### Tags

```http
POST /api/tags
content-type: application/json

{
  "name": "sqlite"
}
```

Responses:

- `201` newly created
- `200` existing record returned
- `400` malformed or empty name

### Categories

```http
POST /api/categories
content-type: application/json

{
  "name": "Research"
}
```

Responses mirror tags.

### Attach tag to memory

```http
POST /api/memories/tags
content-type: application/json

{
  "memoryId": "memory-id",
  "tagId": "tag-id"
}
```

Also support create-or-attach by name for the browse `Add tag` popup:

```json
{
  "memoryId": "memory-id",
  "name": "sqlite"
}
```

Rules:

- exactly one of `tagId` or `name` is accepted
- idempotent existing relation returns `200`
- missing memory/tag returns `404`
- name path creates or resolves the tag, then attaches it

### Attach category to memory

```http
POST /api/memories/categories
content-type: application/json

{
  "memoryId": "memory-id",
  "categoryId": "category-id"
}
```

Also support create-or-attach by name:

```json
{
  "memoryId": "memory-id",
  "name": "Research"
}
```

Rules mirror tag assignment.

### Delete memory

```http
DELETE /api/memories/:memoryId
```

Responses:

- `204` deleted
- `404` missing memory
- `500` deletion failed

## Deletion service contract

Implement deletion in a service rather than directly inside the route.

Deletion must remove:

- SQLite `memories` row
- SQLite cascaded `highlights`
- SQLite cascaded `memory_tags`
- SQLite cascaded `memory_categories`
- filesystem directory for the memory under `storePath`
- git backup tracking for the deleted memory content when backup is enabled

Deletion must not remove:

- global `tags`
- global `categories`
- unrelated content directories

Recommended safe flow:

1. Load config and initialize DB.
2. Read deletion target `{ id, contentPath }`.
3. Resolve the memory directory under `storePath`.
4. Assert the resolved directory is inside `storePath`.
5. Move the directory to a delete-staging path under `storePath` if feasible.
6. Delete the SQLite row.
7. Queue or execute a backup deletion job for the removed content path when git backup is enabled.
8. Remove the staged directory.
9. If SQLite deletion fails after staging, restore the staged directory.

Backup deletion strategy:

- A normal memory delete must not leave the deleted `CONTENT.md` tracked in the
  backup repository.
- Prefer adding an explicit backup job type for deleted content paths, for
  example `{ kind: "delete", contentPaths: [...] }`, so the backup worker can
  stage removals and commit them.
- If the current backup queue only supports changed content paths, extend it in
  the same subtask or document why deletion backup is deferred and surface the
  risk in the PR.
- The route should return success only after the local SQLite/filesystem delete
  succeeds. Backup push failure may be reported through the existing backup
  warning channel, but it must not silently resurrect or retain deleted content
  in the backup contract.

If implementation chooses a simpler direct delete flow, document why the consistency tradeoff is acceptable and add tests for the failure mode that remains.

## Validation rules

- JSON body must be an object.
- Reject unexpected body shapes.
- Trim taxonomy names.
- Reject empty taxonomy names.
- Preserve display case unless a repository-level normalized-name design is added in subtask 18.1.
- Never trust client-provided paths.
- For memory IDs, require non-empty string at the route layer and let repository determine existence.

## Tests

Cover:

- read status true/false success
- read status malformed payload
- read status missing memory
- create tag success
- create category success
- duplicate tag/category returns existing record
- attach tag by ID
- attach tag by name
- attach category by ID
- attach category by name
- attach missing memory
- attach missing tag/category
- delete memory success
- delete missing memory
- delete removes content directory
- delete queues or records backup deletion for the removed content path when backup is enabled
- delete does not remove global tags/categories
- delete does not accept path traversal through content path

## Verification

```sh
mise exec -- bun run test tests/server/routes/api-memory-read-status.test.ts
mise exec -- bun run test tests/server/routes/api-memory-delete.test.ts
mise exec -- bun run test tests/server/routes/api-taxonomy.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Public mutation routes exist and match the contracts above.
- Route files delegate persistence to repositories/services.
- Filesystem deletion is constrained to the configured store path.
- Memory deletion has an explicit backup deletion strategy for removed content paths.
- No UI code is introduced in this subtask.
