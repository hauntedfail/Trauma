# 18.13 Review follow-up implementation alignment

## Goal

Align the already-in-progress `feat/task-18-memory-actions` implementation with
the Task 18 review-driven specification changes added on
`workflow18-read-status`.

This is a follow-up correction plan, not a new product feature slice. The goal
is to make the current Task 18 implementation conform to the revised docs
without reopening Task 19.

## Branch and worktree contract

Implementation branch:

```text
feat/task-18-memory-actions
```

Implementation worktree:

```text
/Users/vvx/projekt/www/trauma
```

Spec source branch:

```text
workflow18-read-status
```

Before editing implementation code, merge the spec branch into the
implementation branch:

```sh
cd /Users/vvx/projekt/www/trauma
git fetch origin
git merge origin/workflow18-read-status
```

Use merge rather than rebase. The implementation branch already contains
substantial Task 18 work and its history should not be rewritten for this
follow-up.

## Scope

In scope:

- Task 18 settings language contract.
- Task 18 OpenAI auth placeholder behaviour.
- Task 18 memory deletion and backup deletion strategy.
- Task 18 highlight `contentHash` format.
- Task 18 Flashback server-side section validation.
- Task 18 imported iframe sandbox default.
- Tests and docs needed to prove the above implementation alignment.

Out of scope:

- Task 19 Codex translation runner.
- Task 19 translated content storage.
- Task 19 translation backup queueing.
- Task 19 stale translation status.
- Any unrelated UI redesign or Task 17 refine work.

Do not edit files under:

```text
docs/workflows/task-19-codex-translation/
docs/workflows/task-19-codex-translation.md
```

## 1. Merge updated Task 18 specification

Steps:

1. Confirm the worktree is on `feat/task-18-memory-actions`.
2. Confirm there are no uncommitted implementation changes, or commit/stash
   them before merging.
3. Fetch `origin`.
4. Merge `origin/workflow18-read-status`.
5. Resolve conflicts by preserving implementation work and accepting the revised
   Task 18 contracts.

Acceptance criteria:

- `feat/task-18-memory-actions` contains the latest Task 18 docs from
  `workflow18-read-status`.
- No Task 19 implementation is changed as part of the merge.

## 2. Settings language contract

Problem:

The implementation may still use short language codes such as `ja`, while the
revised Task 18 contract requires BCP 47 values such as `ja-JP`.

Required behaviour:

- Persist supported BCP 47 language codes.
- Return BCP 47 language codes from settings APIs.
- Use `ja-JP` as the Japanese value.
- UI select values must match the server-supported values.
- Reject unsupported language values server-side.
- If short codes are accepted for compatibility, normalize them before storage
  and always return the canonical BCP 47 value.

Implementation targets:

- Settings schema/repository/service.
- Settings API routes.
- Settings page loader/action code.
- Settings page select options.
- Settings tests.

Acceptance criteria:

- `GET /api/settings` returns `"translationTargetLanguage": "ja-JP"` for the
  Japanese default or saved value.
- `PATCH /api/settings/translation-language` accepts supported BCP 47 values.
- The settings UI reloads without select-value mismatch.
- Tests cover supported, unsupported, and malformed language values.

## 3. OpenAI auth placeholder behaviour

Problem:

Task 18 owns the settings page surface, but it does not yet implement Task 19's
real Codex-backed auth. The implementation must not fake enabled auth before a
real provider exists.

Required behaviour:

- If a real provider or stored auth record exists, enable may return enabled.
- If no real provider exists, enable returns a clear not-configured response.
- Provider-missing enable attempts must leave auth status disabled.
- Already-enabled requests remain idempotent and do not overwrite auth state.
- API responses must never include secret material.

Implementation targets:

- OpenAI auth adapter.
- Settings auth service.
- `POST /api/settings/openai-auth/enable`.
- `DELETE /api/settings/openai-auth`.
- Settings page UI error/status handling.
- Settings auth tests.

Acceptance criteria:

- Provider-missing enable does not create a cosmetic enabled row.
- Already-enabled enable returns the documented already-enabled response.
- Delete auth clears only auth state.
- Tests prove no secret material is returned.

## 4. Memory deletion backup strategy

Problem:

Deleting a memory from SQLite and the local `storePath` can leave the removed
`CONTENT.md` tracked in the backup repository. That can resurrect or retain a
deleted memory during restore.

Required behaviour:

- Normal memory deletion must have an explicit backup deletion path.
- When backup is enabled, the deleted content path must be queued or recorded so
  the backup worker can stage and commit the removal.
- Local SQLite/filesystem deletion success remains separate from remote push
  success.
- Backup push failure should use the existing warning channel rather than
  silently hiding the problem.

Implementation targets:

- Memory deletion service.
- Backup queue types and worker.
- Backup status/warning handling if needed.
- Delete API tests.

Recommended design:

- Add a backup job kind for deletion, for example
  `{ kind: "delete", contentPaths: [...] }`.
- The backup worker stages removed paths and commits the deletion.
- If the current queue can already express deleted paths safely, document that
  path and add regression tests.

Acceptance criteria:

- Deleting a memory removes SQLite metadata and local content directory.
- Backup-enabled deletion records/stages the removed content path.
- Restore cannot silently bring back a deleted memory from an old tracked
  `CONTENT.md`.
- Tests cover backup-enabled deletion.

## 5. Highlight `contentHash` format

Problem:

The revised highlight contract requires a concrete hash format so highlight
creation, validation, and stale detection cannot drift.

Required behaviour:

- `contentHash` format is `sha256:<hex>`.
- Hash input is canonical reader text, not raw Markdown.
- Use the exact same canonical text used for `startOffset` and `endOffset`.
- Normalize line endings to `\n` before offset calculation and hashing.
- Do not trim leading or trailing text for hashing.
- Do not apply Unicode compatibility normalization unless the same
  normalization is shared by offset calculation and rendering.
- On hash mismatch, do not render a highlight at a guessed location.

Implementation targets:

- Canonical reader text utility.
- Highlight creation API.
- Highlight range validation.
- Highlight rendering/stale handling.
- Highlight tests.

Acceptance criteria:

- Duplicate selected text is disambiguated by offsets.
- `contentHash` uses `sha256:<hex>`.
- Hash and offset calculations share one canonical text path.
- Stale/hash-mismatched highlights are not rendered at the wrong occurrence.

## 6. Flashback server-side section validation

Problem:

The API must not trust client-supplied section anchors, titles, paths, or
offsets. A direct API caller should not be able to create Flashbacks for
sections that do not exist.

Required behaviour:

- The create route loads the target memory's reader section model server-side.
- Resolve by `sectionAnchor` first.
- If needed, resolve by `sectionPath`.
- Use title and offsets as guards, not sufficient identity.
- Reject missing or ambiguous section identity with `400`.
- Store normalized metadata from the server-resolved section.

Implementation targets:

- Reader section model/page-data.
- Flashback creation service.
- `POST /api/flashbacks`.
- Flashback repository if it currently trusts request metadata.
- Flashback API tests.

Acceptance criteria:

- Missing section anchors cannot create Flashbacks.
- Ambiguous sections are rejected rather than guessed.
- Stored Flashback metadata comes from the server-resolved section.
- `/flashback` links cannot be broken by direct API calls with fake anchors.

## 7. Imported iframe sandbox default

Problem:

The default iframe sandbox must not combine `allow-scripts` with
`allow-same-origin`, because that weakens the sandbox boundary for third-party
content.

Required behaviour:

- Default sandbox is:

```html
sandbox="allow-scripts allow-presentation"
```

- Do not include `allow-same-origin` by default.
- Only add `allow-same-origin` for a provider-specific policy with tests and a
  documented reason.
- Continue stripping `srcdoc`, `on*` handlers, unsafe attributes, and unsafe URL
  schemes.
- Continue applying `loading="lazy"` and `referrerpolicy="no-referrer"`.

Implementation targets:

- Server importer media sanitizer.
- Reader Markdown sanitizer.
- Browser extension capture sanitizer.
- Media/importer/capture tests.

Acceptance criteria:

- Safe iframe output omits `allow-same-origin` by default.
- Unsafe iframe forms remain rejected or sanitized.
- Importer, reader, and browser capture policies do not drift.

## 8. Focused verification

Run the smallest relevant test set for changed implementation surfaces.

Recommended targeted commands:

```sh
mise exec -- bun run test tests/server/routes/api-settings.test.ts
mise exec -- bun run test tests/server/settings/settings.test.ts
mise exec -- bun run test tests/components/settings-page.test.tsx
mise exec -- bun run test tests/server/routes/api-memory-delete.test.ts
mise exec -- bun run test tests/server/routes/api-highlights.test.ts
mise exec -- bun run test tests/server/highlights/ranges.test.ts
mise exec -- bun run test tests/server/routes/api-flashbacks.test.ts
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/server/importer/importer.test.ts
mise exec -- bun run test tests/server/reader/markdown-renderer.test.ts
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run test tests/browser-extension/capture.test.ts
mise exec -- bun run typecheck
```

If a listed path does not exist, use the nearest current test file that covers
the same surface and record the substitution in the PR body.

## PR handoff

The implementation PR must state:

- Which `workflow18-read-status` commit was merged.
- Settings language normalization behaviour.
- OpenAI auth provider-missing behaviour.
- Memory deletion backup strategy.
- Highlight hash format.
- Flashback server-side section validation strategy.
- Iframe sandbox policy.
- Exact verification commands and outcomes.
- Task 19 review items remain intentionally out of scope.

## Completion criteria

- `feat/task-18-memory-actions` implements every in-scope revised Task 18
  contract above.
- Task 19 files and behaviour are not changed.
- Review comments for Task 18 can be answered with implementation evidence.
- Any remaining known gap is documented explicitly in the implementation PR.
