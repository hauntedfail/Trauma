# PR #17 Historical Planned Review Responses

Status: historical review-response snapshot, not an active backlog
Branch: `triage/ui`
PR: <https://github.com/hauntedfail/Trauma/pull/17>
Captured at: 2026-05-13

This report records the 22 unresolved review threads that applied to the PR #17
diff at capture time. PR #17 has since landed; use this file only as historical
review context. Do not treat it as an active work queue without revalidating
each item against current `main`.

Outdated unresolved threads at capture time were intentionally excluded from
this list.

## Summary

- Captured unresolved review threads: 22
- Scope: PR #17 diff at capture time
- Excluded: outdated generated-storage and obsolete extension-injection threads
- GitHub state at capture time: `Verify` failing, `CodeRabbit` passing

## Captured Planned Responses

### 1. Revalidate browse data after memory creation

- Source: Codex Review
- Path: `src/components/memories/AddMemoryForm.tsx`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3223778390>
- Review: after successful add-memory POST, the cached browse query can remain
  stale when returning to `/memories`.
- Planned response: verify the Solid query cache path and add targeted
  revalidation after creation if the cache remains stale.

### 2. Avoid browser-visible raw extractor errors

- Source: Codex Review
- Path: `src/server/importer/index.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3226185495>
- Review: Defuddle/dependency error text can be persisted and returned through
  the API as `extractionError`.
- Planned response: keep client-visible extraction failure details stable and
  generic, while preserving raw diagnostics server-side only.

### 3. Block private DNS names in extracted display URLs

- Source: Codex Review
- Path: `src/server/importer/extractor.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3226185513>
- Review: extracted image/link hostnames can bypass the fetch path's public-host
  validation and later render as active Markdown.
- Planned response: align extracted display URL handling with the public-host
  policy, or neutralize unvalidated hostnames before Markdown generation.

### 4. Use the full browser-import origin env var in workflow docs

- Source: CodeRabbit
- Path: `docs/workflows/task-16d-browser-assisted-import/01-architecture-security-boundary.md`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3226658289>
- Review: the workflow text shortens the setting to `ALLOWED_ORIGINS` even
  though the actual variable is `TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS`.
- Planned response: update wording to use the full env var name consistently.

### 5. Bound browser-import request bodies before reading

- Source: Codex Review
- Path: `src/routes/api/browser-import.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227107318>
- Review: `request.text()` reads the whole body before applying the configured
  byte cap.
- Planned response: enforce a bounded read or reject invalid/unbounded lengths
  before buffering the browser-import body.

### 6. Normalize extension instance URL to origin

- Source: Codex Review
- Path: `extensions/browser/src/settings.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227107323>
- Review: storing `http://127.0.0.1:3000/memories` causes the extension to post
  to `/memories/api/browser-import`.
- Planned response: store only the instance origin or otherwise strip pathname,
  search, and hash from saved TRAUMA instance URLs.

### 7. Align HTTPS settings with extension host permissions

- Source: Codex Review
- Path: `extensions/browser/src/settings.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227107333>
- Review: settings accept HTTPS loopback URLs, but the manifest only grants
  HTTP host permissions.
- Planned response: either add matching HTTPS host permissions or reject HTTPS
  instance URLs in settings validation.

### 8. Keep browser-import canonical URLs inside URL policy

- Source: Codex Review
- Path: `src/server/browser-import/import-browser-capture.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227107344>
- Review: untrusted captured canonical URLs can replace the source URL without
  the importer URL policy.
- Planned response: validate canonical targets with the same URL policy before
  persistence, or fall back to the captured source URL.

### 9. Reject ordinary web origins in browser-import allowlist

- Source: Codex Review
- Path: `src/server/browser-import/config.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227107347>
- Review: configuring a normal web origin can make browser-import accept
  bearer-token imports from that website.
- Planned response: constrain allowed browser-import origins to extension
  schemes even when an allowlist is configured.

### 10. Prevent capture traversal limit bypass

- Source: CodeRabbit
- Path: `extensions/browser/src/capture.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227779915>
- Review: `querySelectorAll("*")` scans full subtrees before the traversal node
  cap is enforced.
- Planned response: restructure traversal so the cap is enforced during
  traversal rather than after full-subtree collection.

### 11. Restore loopback bind defaults

- Source: Codex Review
- Path: `.env.example`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227807620>
- Review: the setup path no longer documents or sets `HOST=127.0.0.1`, which
  can expose the local no-auth app on LAN.
- Planned response: verify current runtime defaults and restore an explicit
  loopback default in the loaded setup path if needed.

### 12. Keep import timeout active during extraction

- Source: Codex Review
- Path: `src/server/importer/index.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227807629>
- Review: the timeout is cleared after fetch body read, before Defuddle or
  injected extraction work completes.
- Planned response: cover extraction with the same timeout budget or introduce a
  separate extraction timeout.

### 13. Size-check the full browser-import snapshot

- Source: Codex Review
- Path: `extensions/browser/src/capture.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3227807631>
- Review: client-side size checks only measure `articleHtml`, while the payload
  also includes text and metadata.
- Planned response: measure encoded snapshot size before posting, or reduce the
  per-field budget to leave room for JSON overhead.

### 14. Handle thrown failsafe request errors in the UI

- Source: CodeRabbit
- Path: `src/components/backup/BackupFailsafeBanner.tsx`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228588845>
- Review: thrown `submitBackupFailsafeAction` errors can leave
  `pendingAction` set and buttons disabled.
- Planned response: wrap submit in `try/catch/finally`, surface a fallback
  error, and clear pending state in `finally`.

### 15. Do not fail open on backup content filesystem read errors

- Source: CodeRabbit
- Path: `src/server/backup/environment.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228588890>
- Review: `findContentFile` treats every `readdir` error as "no content".
- Planned response: return false only for missing directories and rethrow
  permission or I/O errors.

### 16. Create `projectPath` before `git init`

- Source: CodeRabbit
- Path: `src/server/backup/environment.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228588897>
- Review: `bootstrapBackupRepository` runs git with `cwd: config.projectPath`
  before ensuring that directory exists.
- Planned response: create `config.projectPath` before running git bootstrap.

### 17. Do not ignore unreadable source directories during failsafe migration

- Source: CodeRabbit
- Path: `src/server/backup/failsafe.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228588920>
- Review: `listFiles` returns an empty list for all `readdir` errors.
- Planned response: return an empty list only for `ENOENT`; propagate other
  filesystem errors so migration/apply can fail visibly.

### 18. Require same-origin confirmation for failsafe actions

- Source: Codex Review
- Path: `src/routes/api/backup/failsafe/migrate.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228651944>
- Review: state-changing failsafe endpoints parse simple cross-origin requests
  without content-type or origin enforcement.
- Planned response: add same-origin/CSRF protection or require non-simple JSON
  requests before applying migration or revert actions.

### 19. Provide recovery for unstamped existing data

- Source: Codex Review
- Path: `src/server/backup/environment.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228651950>
- Review: existing memory data without a backup environment stamp can create an
  alert that neither migrate nor revert can clear.
- Planned response: add an accept-current/current-store recovery path or avoid
  using the revert/migrate alert shape for unstamped data.

### 20. Honour fixture mode in the failsafe loader

- Source: Codex Review
- Path: `src/components/backup/backup-failsafe-loader.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228651953>
- Review: `bun run dev:smoke` fixture mode can fail because the AppShell
  failsafe query loads runtime config even when fixture browse data is enabled.
- Planned response: return no alert in fixture mode or otherwise tolerate absent
  runtime config in the failsafe loader.

### 21. Clear push-failure alerts after successful retry

- Source: Codex Review
- Path: `src/server/backup/index.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228651956>
- Review: a `backup_push_failed` alert can remain after a later successful push.
- Planned response: clear push-failure alert state once the retry succeeds.

### 22. Commit migrated backup files before clearing the alert

- Source: Codex Review
- Path: `src/server/backup/failsafe.ts`
- Thread: <https://github.com/hauntedfail/Trauma/pull/17#discussion_r3228651962>
- Review: `migrate --apply` can copy files into the new target and clear the
  alert without committing those files, leaving them untracked and unpushed.
- Planned response: ensure migrated files are staged/committed or queued for
  backup before the alert is cleared.

## Excluded Unresolved Outdated Threads

- Generated cold-storage memories under the literal `~/...` tree.
- Extension injected capture function self-contained/bundled-content-script
  thread.

These are excluded from the planned 22-item response set because GitHub marks
them as outdated against the current diff. They can be reopened only if a fresh
thread or local validation proves the issue still exists.
