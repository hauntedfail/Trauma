# 18.15 Memory delete consistency and backup hardening

## Goal

Harden memory deletion so the API contract, SQLite state, local content store,
and git backup deletion path cannot drift.

This is a correction subtask for Task 18. It does not add a new product feature.
It clarifies the delete contract and closes failure-boundary gaps found while
reviewing the current implementation.

## Current evidence

Current route behaviour:

- `DELETE /api/memories/:memoryId` returns `204 No Content` on success.
- The client-side delete helper treats any `response.ok` result as success and
  does not parse a response body.
- Therefore `No Content` is not itself an inconsistency. It is the current
  success contract for DELETE.

Current implementation risk:

- The service stages the content directory, deletes the SQLite memory row, then
  removes the staged directory and enqueues a backup deletion job.
- If post-row-delete staging cleanup throws, the memory row can be gone while
  sensitive content remains under `.delete-staging/`.
- If backup enqueue throws, the request can fail after the memory row and
  canonical content directory are already gone.
- API-level delete coverage proves Flashback and taxonomy cascades, but it does
  not yet seed and verify Moment cascade through the public DELETE route.
- Backup deletion currently stages `CONTENT.md` only. Current Task 18 also
  writes `FLASHBACKS.json`, so deletion backup must include that export path or
  stage the whole deleted memory directory.

## Target delete contract

Delete target:

1. The SQLite `memories` row for the requested memory id.
2. SQLite rows that are owned by that memory through cascade relationships:
   Flashbacks, Moments, and memory taxonomy join rows.
3. The canonical local content directory under
   `storePath/memories/{memoryId}/`.
4. The backup repository's tracked representation of that memory content,
   including `CONTENT.md` and Flashback metadata exports such as
   `FLASHBACKS.json`.

Non-target:

- Global `tags` and `categories` records.
- Unrelated store paths.
- Task 19 translation records or translated content, unless Task 19 later adds
  its own cascade/delete contract.

## Delete order decision

Use staged filesystem deletion before SQLite row deletion.

The preferred order is:

1. Load the memory deletion target from SQLite.
2. Resolve `contentPath` against `storePath` and reject paths escaping the store.
3. Rename the canonical memory content directory to a private staging path under
   `storePath/.delete-staging/`.
4. Delete the SQLite memory row.
5. If the SQLite deletion fails, restore the staged directory to the canonical
   memory directory and return failure.
6. Remove the staged directory. If this fails, return a controlled failure and
   log the staged path; content erasure is not complete while staged content
   remains on disk.
7. Attempt to queue or record the backup deletion job. If this fails, record a
   warning instead of changing the local deletion result.
8. Return `204 No Content` after local deletion is complete.

Rationale:

- Deleting the SQLite row first can leave an orphaned canonical content
  directory if filesystem deletion fails.
- Deleting filesystem content first without staging can leave a SQLite row that
  points to missing content if database deletion fails.
- Staging first makes the canonical content path disappear while preserving a
  rollback path until the SQLite row deletion succeeds.
- Staging cleanup is part of local content erasure and must not be masked as
  success.
- Backup enqueue/push must not decide whether local deletion succeeded. Backup
  failures belong to the backup warning/retry channel.

## Domain plan

### 1. API contract

Files:

- `src/routes/api/memories/[memoryId].ts`
- `tests/server/routes/api-memory-delete.test.ts`

Required decisions:

- Keep `204 No Content` as successful DELETE output.
- Do not return deleted memory JSON.
- Ensure unexpected service exceptions are converted into a controlled `500`
  response instead of leaking framework-level errors.
- Error responses should keep the existing user-facing shape:

```json
{ "error": "failed to delete memory" }
```

Regression tests:

- Successful delete returns status `204` and empty body.
- A service failure before local deletion returns `500`.
- A route-level unexpected service throw returns `500` without deleting
  additional data beyond the failure point being tested.

### 2. Memory deletion service boundary

Files:

- `src/server/memories/delete-memory.ts`
- `tests/server/memories/delete-memory.test.ts`

Required behaviour:

- Treat path-resolution failure as a normal `{ status: "failed" }` result.
- Treat non-`ENOENT` staging failure as `{ status: "failed" }` before mutating
  SQLite.
- Keep missing content directory tolerant: a memory record may still be deleted
  when its content directory is already absent.
- Restore the staged directory if SQLite row deletion fails.
- Treat staged-directory cleanup failure after SQLite deletion as a controlled
  delete failure with a precise operational error. Do not queue backup deletion
  while staged content still exists.
- Do not let backup enqueue failure turn a completed local deletion into a
  failed user-visible delete.
- Return success only after the canonical content directory is gone, the staged
  directory is removed, and the SQLite row is gone.

Recommended result shape:

```ts
export type DeleteMemoryResult =
  | { status: "deleted"; warnings?: DeleteMemoryWarning[] }
  | { status: "not_found" }
  | { status: "failed"; error: string; partial?: DeleteMemoryPartialFailure };

export type DeleteMemoryPartialFailure =
  | "content_cleanup_failed";

export type DeleteMemoryWarning =
  | { kind: "backup_enqueue_failed"; error: string };
```

The route may still return `204` for `deleted` with warnings. The warning should
be logged or routed through the existing backup warning channel; it should not
make the user's local deletion appear to have failed.

Regression tests:

- Backup enqueue throws after SQLite/content deletion: service resolves
  `{ status: "deleted", warnings: [...] }`, memory row is gone, content directory
  is gone.
- SQLite deletion throws after staging: service returns `failed` and restores the
  content directory.
- Staged-directory cleanup throws after SQLite deletion: service returns
  `failed` with `partial: "content_cleanup_failed"`, and the error includes
  enough path context for manual cleanup.
- Missing content directory with existing SQLite row: service deletes the row
  and returns `deleted`.

### 3. SQLite cascade coverage

Files:

- `tests/server/routes/api-memory-delete.test.ts`
- `tests/server/db/repositories.test.ts`

Required behaviour:

- Public DELETE route coverage must seed at least one Moment owned by the memory
  and assert it is gone after deletion.
- Repository-level cascade tests may remain as lower-level proof, but they are
  not enough for the public route contract.

Regression tests:

```sql
select count(*) as count from moments
```

Expected after successful API delete:

```json
{ "count": 0 }
```

### 4. Backup deletion path

Files:

- `src/server/backup/index.ts`
- `src/server/memories/delete-memory.ts`
- `tests/server/backup/git-backup.test.ts`
- `tests/server/memories/delete-memory.test.ts`

Required behaviour:

- A normal memory deletion must enqueue a backup deletion job for the deleted
  backup-tracked content.
- The backup runner must stage deletion for the tracked memory content path.
- Remote push failure must use the existing backup warning/retry behaviour and
  must not roll back local deletion.

Decision to apply now:

- `CONTENT.md` is not the only backup-tracked file in a memory directory.
- Task 18 Flashbacks are backed by SQLite and exported to `FLASHBACKS.json`.
- Memory deletion must stage the deletion of both `CONTENT.md` and
  `FLASHBACKS.json`, or stage every tracked path under
  `storePath/memories/{memoryId}/`.
- If future work stores local images, captures, translations, or sidecar assets
  under `storePath/memories/{memoryId}/`, that feature must update this backup
  deletion contract to stage every tracked path under the memory directory.

Regression tests:

- Backup-enabled deletion enqueues `reason: "memory_deletion"`.
- Backup runner commits deleted `CONTENT.md` and `FLASHBACKS.json` paths when
  both were tracked.
- Backup enqueue failure does not make the delete API return failure after the
  SQLite row and canonical content directory are gone.

### 5. Manual verification

Run after implementation:

```sh
mise exec -- bun --bun x vitest run tests/server/routes/api-memory-delete.test.ts tests/server/memories/delete-memory.test.ts tests/server/db/repositories.test.ts tests/server/backup/git-backup.test.ts tests/components/memory-action-menu.test.ts tests/components/memory-browse-actions.test.ts tests/components/memory-reader-actions.test.ts
```

Manual smoke:

1. Start the app with an existing memory.
2. Delete the memory from `/memories`.
3. Confirm the network response is `204 No Content`.
4. Confirm the memory disappears without refresh.
5. Confirm the SQLite `memories` row is gone.
6. Confirm `storePath/memories/{memoryId}/` is gone.
7. If backup is enabled, confirm git status or the latest backup commit records
   deletion of `storePath/memories/{memoryId}/CONTENT.md` and
   `storePath/memories/{memoryId}/FLASHBACKS.json` when the export exists.
8. Delete a memory from `/memories/:id`.
9. Confirm the app navigates back to `/memories`.
10. Confirm no user-facing failure is shown for successful `204 No Content`.

## Acceptance criteria

- `204 No Content` is documented and tested as successful DELETE output.
- A successful delete removes the SQLite row and canonical memory content
  directory.
- A successful delete does not leave the deleted content under
  `storePath/.delete-staging/`.
- Flashbacks, Moments, memory tags, and memory categories cascade through the
  public DELETE route.
- Global tags and categories remain.
- Backup deletion is queued or recorded for the removed tracked content.
- Backup enqueue/push failure does not make completed local deletion appear to
  have failed.
- The plan does not change Task 19 translation ownership.
