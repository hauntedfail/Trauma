# Task 16f: Backup Environment Failsafe Workflow

## Goal

Add startup and UI failsafes for backup environment drift, missing git
repository initialization, and backup push failures so Trauma never silently
writes memories into an unexpected backup directory.

## Parent Workflow

This is a triage subtask after the git backup queue foundation. It preserves the
existing backup model:

- `projectPath` is the git working directory for markdown backup.
- `storePath` must be inside `projectPath`.
- backup commits only content under `storePath`.
- the application repository and the backup repository are separate by default.

Current status: this workflow has landed on `main`. Keep this file as the
execution record for the backup environment failsafe domain; create a new
workflow for follow-up behaviour changes.

## Problem Statement

Users can edit `projectPath` or `storePath` in `trauma.config.json`. If the
current config points at a different backup location than the location that
already contains the user's memory data, Trauma must not proceed silently.

The app must detect path drift, warn in logs and in the web interface, and
offer two explicit recovery actions:

- revert the config to the previous known backup paths.
- migrate existing backup data into the currently configured target directory.

The warning must be red and non-dismissible until the user chooses a recovery
action or manually repairs the environment.

## Required Context

- [Configuration reference](../references/configuration.md)
- [Data and storage architecture](../architecture/data-and-storage.md)
- [Runtime flows](../architecture/flows.md)
- [Drizzle and SQLite rules](../references/coding-standards/drizzle-sqlite.md)
- [Security boundaries](../references/coding-standards/security-boundaries.md)
- [Task 8 Git backup queue](task-08-git-backup-queue.md)
- [Task 16b Drizzle and SQLite hardening](task-16b-db-orm-hardening.md)

## Ownership

Primary server files:

- `src/server/config/load.ts`
- `src/server/config/types.ts`
- `src/server/backup/index.ts`
- `src/server/backup/status.ts` only if a new status is required.
- `src/server/backup/environment.ts`
- `src/server/backup/failsafe.ts`
- `src/server/backup/content-integrity.ts`
- `src/server/db/schema.ts`
- `src/server/db/repositories.ts`
- `src/routes/api/backup/failsafe.ts`
- `src/routes/api/backup/failsafe/revert.ts`
- `src/routes/api/backup/failsafe/migrate.ts`
- `src/routes/api/backup/failsafe/delete-missing-record.ts`

Primary UI files:

- `src/components/shell/AppShell.tsx`
- `src/components/backup/BackupFailsafeBanner.tsx`
- `src/components/backup/backup-failsafe-loader.ts`
- `src/components/backup/backup-failsafe-actions.ts`

Primary script files:

- `scripts/trauma-backup-failsafe.ts`
- `package.json` only if adding a named script is useful.

Primary tests:

- `tests/server/config/config.test.ts`
- `tests/server/backup/backup-environment.test.ts`
- `tests/server/backup/git-backup.test.ts`
- `tests/server/routes/api-backup-failsafe.test.ts`
- `tests/components/backup-failsafe.test.ts`
- `tests/server/backup/backup-failsafe-cli.test.ts`

Conditional docs:

- `docs/references/configuration.md`
- `docs/operations/local-self-hosting.md`
- `docs/references/coding-standards/security-boundaries.md`
- `docs/quality/verification.md`

Out of scope:

- Public multi-user auth.
- Background migration without explicit user action.
- Moving the SQLite database automatically.
- Backing up arbitrary directories outside `projectPath`.
- Supporting non-git backup engines.
- Force-pushing or rewriting backup repository history.

## Core Design

Persist a backup environment stamp in SQLite after successful backup environment
validation. The stamp records:

- resolved `projectPath`
- resolved `storePath`
- git repository identity when available
- configured remote name
- configured remote URL when available
- backup branch
- timestamp of the stamp

At startup and before exposing repository-backed UI, compare the current config
against the stored stamp.

If paths drift and existing memory data is present, create an active failsafe
alert. Do not silently initialize a new backup repository or write new memory
content into the new path until the alert is resolved.

Clean state is the only automatic-bootstrap case. Clean state means:

- no persisted memories in SQLite.
- no `{storePath}/memories/**/CONTENT.md` files.
- no previous backup environment stamp.

Only in clean state may Trauma create `projectPath`, create `storePath`, and run
`git init` automatically when backup is enabled and `projectPath` is not yet a
git repository.

## User-Facing English Copy

Use this exact meaning for logs and UI. Minor formatting is allowed, but the
message must remain direct.

```text
Backup location changed

TRAUMA detected that the configured backup paths no longer match the paths that
already contain your memory backup data.

Previous project path: {previousProjectPath}
Previous store path: {previousStorePath}
Current project path: {currentProjectPath}
Current store path: {currentStorePath}

Choose how to continue:

Revert config: restore the previous projectPath and storePath.
Migrate backup: move the existing backup data into the currently configured
target directory.

TRAUMA will not silently write memories into the new backup location until this
is resolved.
```

If the configured backup paths and stamp match, but a memory row marked as a
successful backup points at missing, out-of-scope, or untracked content, use a
different alert:

```text
Backup content is inconsistent

TRAUMA found memory metadata marked as successfully backed up, but the
corresponding content file is missing, outside the configured backup paths, or
not tracked by the backup repository.

Current project path: {currentProjectPath}
Current store path: {currentStorePath}
Error: {memory/content detail}

TRAUMA will not silently write new memory data until this content mismatch is
resolved.
```

Do not offer Revert config or Migrate backup for this alert. It is not a path
drift and path migration can only hide the real metadata/content mismatch.
If the alert reason is `missing_file`, offer a separate recovery action:

```text
Delete missing memory record
```

This action must re-check the current database and store path before deleting.
It may delete the orphan SQLite `memories` row only when the corresponding
`CONTENT.md` is still missing. Do not allow this action for `untracked_file`,
`absolute_path`, or `outside_backup_paths`.

For push failures:

```text
Backup push failed

TRAUMA committed the memory backup locally, but pushing to the configured remote
failed.

Remote: {remote}
Branch: {branch}
Error: {error}

Your memory content remains committed locally. Fix the remote repository and
retry backup push.
```

When no remote repository is configured, do not show a warning. Commit locally
and skip push.

## Required Console Output

When path drift is detected, log the warning and include two executable recovery
commands.

```bash
mise exec -- bun run scripts/trauma-backup-failsafe.ts revert --config {configPath}
```

```bash
mise exec -- bun run scripts/trauma-backup-failsafe.ts migrate --config {configPath}
```

The script must print a dry-run summary by default and require `--apply` for
filesystem writes:

```bash
mise exec -- bun run scripts/trauma-backup-failsafe.ts revert --config {configPath} --apply
mise exec -- bun run scripts/trauma-backup-failsafe.ts migrate --config {configPath} --apply
```

The web UI buttons may call server endpoints directly, but logs must always
include the CLI equivalent so a user can recover from the terminal.

## Parent Exec Plan

Execute these phases in order.

### Phase 1: Backup Environment Model

1. Add a backup environment stamp table to the SQLite schema.
   - Store one active row keyed by a constant id such as `default`.
   - Include previous/current path fields needed for warning text.
   - Include git remote name, remote URL, branch, and timestamps.
   - Add a Drizzle migration.

2. Add repository methods for backup environment state.
   - `getBackupEnvironmentStamp()`
   - `upsertBackupEnvironmentStamp()`
   - `getBackupFailsafeAlert()`
   - `upsertBackupFailsafeAlert()`
   - `clearBackupFailsafeAlert()`

3. Add tests proving the schema persists and reads a stamp without disturbing
   existing memory rows.

### Phase 2: Path Drift Detection

1. Create `src/server/backup/environment.ts`.
   - Resolve the current configured `projectPath` and `storePath`.
   - Read the previous stamp from SQLite.
   - Detect whether current paths differ from the stamp.
   - Detect whether memory data exists.

2. Define memory data presence as:
   - any row in `memories`, or
   - any existing `CONTENT.md` under the previous stamped store path, or
   - any existing `CONTENT.md` under the current store path.

3. On drift with existing data, create a red critical alert.
   - Do not mutate the config.
   - Do not move files.
   - Do not initialize git in the new location.

4. Add tests for:
   - no stamp and clean state: no alert.
   - no stamp and existing data: alert requiring manual review.
   - stamp matches current config: no alert.
   - stamp differs and existing data exists: alert with previous/current paths.
   - stamp differs but clean state: update stamp and continue.

### Phase 3: Initial Git Repository Bootstrap

1. Treat the backup repository as separate from the app repository.
   - `projectPath: "./data"` means `./data` itself must be a git repository.
   - Do not use the Trauma app repository as an implicit fallback.

2. On startup, if backup is enabled and `projectPath` is not a git repository:
   - if clean state, create `projectPath`, create `storePath`, and run
     `git init --initial-branch={branch}`.
   - if not clean state, create a failsafe alert instead of running `git init`.

3. If config includes a remote URL and the repo has no remote with the configured
   remote name, add it only during clean-state bootstrap.

4. Add tests with a temp directory proving:
   - clean first start initializes a git repo under `projectPath`.
   - non-clean start without git repo warns and does not initialize.
   - app repo `.git` is ignored when `projectPath` points at `./data`.

### Phase 4: Remote Push Failsafe

1. Before every backup commit, validate that `projectPath` is still the root of
   a git-managed backup repository.

```bash
git -C {projectPath} rev-parse --show-toplevel
```

   The command must resolve to `{projectPath}` exactly. If it fails, or if it
   resolves to a parent directory such as the Trauma application repository,
   stop the backup job, create a critical failsafe alert, and do not commit.
   This covers cases where the backup directory was moved, `.git` was removed,
   or `projectPath` accidentally became nested inside another git repository.

2. Before pushing, verify the configured remote exists:

```bash
git remote get-url {remote}
```

3. If the remote is missing:
   - skip push.
   - leave backup status as local commit success.
   - do not warn.

4. If the remote exists and push fails:
   - mark the memory backup status as failed or push-failed according to the
     existing status model decision.
   - create a critical failsafe alert.
   - log the English warning text.
   - include the likely repair command:

```bash
git -C {projectPath} remote set-url {remote} {remoteUrl}
git -C {projectPath} push {remote} HEAD:{branch}
```

4. Add tests for:
   - missing remote skips push without alert.
   - configured remote pushes normally.
   - push failure records alert and keeps the local commit.
   - `projectPath` without `.git` fails before commit and creates an alert.
   - `projectPath` nested under the app repository but not its own git root
     fails before commit and creates an alert.

### Phase 5: Recovery CLI

1. Implement `scripts/trauma-backup-failsafe.ts`.
   - `status --config {path}`
   - `revert --config {path}`
   - `revert --config {path} --apply`
   - `migrate --config {path}`
   - `migrate --config {path} --apply`

2. `revert --apply` must:
   - update `projectPath` and `storePath` in the config file to previous stamped
     values.
   - preserve unrelated config fields and formatting as much as practical.
   - clear the alert only after a reload confirms the config matches the stamp.

3. `migrate --apply` must:
   - create the current `projectPath` and `storePath` if needed.
   - copy or move existing backup content from the previous store path to the
     current store path.
   - never overwrite existing target files without a deterministic conflict
     error.
   - initialize git only if the target backup repo is clean-state eligible.
   - write a new backup environment stamp only after migration succeeds.

4. Add tests using temp dirs for dry-run output, applied revert, applied
   migration, and target conflict rejection.

### Phase 6: Web Interface Alert And Actions

1. Add a loader for backup failsafe status.
   - It must run in server context.
   - It must return active alerts to the shell.

2. Add `BackupFailsafeBanner`.
   - Red visual treatment.
   - Non-dismissible.
   - Visible across the app shell.
   - Shows previous and current paths.
   - Shows two primary actions: `Revert config` and `Migrate backup`.
   - Shows push failure details when the alert type is push failure.

3. Add server action endpoints.
   - `POST /api/backup/failsafe/revert`
   - `POST /api/backup/failsafe/migrate`
   - Both must reuse the same domain functions as the CLI.
   - Both must return a structured result and require explicit confirmation in
     the request body.

4. UI copy for buttons:
   - `Revert config`
   - `Migrate backup`

5. Add component and route tests proving:
   - the banner renders in red.
   - the banner cannot be dismissed.
   - buttons call the correct endpoints.
   - active alert appears in the shell on every route that uses the shell.

### Phase 7: Documentation And Handoff

1. Update configuration docs.
   - Explain that `~` is not expanded in JSON config.
   - Recommend absolute `/Users/...` paths or config-relative paths.
   - Re-state that `storePath` must be inside `projectPath`.

2. Update local self-hosting docs.
   - Explain first-start git init.
   - Explain remote push behavior.
   - Explain missing remote skip vs push failure warning.

3. Update verification docs only if new scripts need to be run by humans.

4. PR handoff must include:
   - exact drift scenario tested.
   - exact git bootstrap scenario tested.
   - exact remote skip and push failure scenarios tested.
   - screenshots or textual evidence for the red UI alert.

## Acceptance Criteria

- Trauma detects when current `projectPath` or `storePath` differs from the
  previously stamped backup environment while existing data is present.
- Drift detection logs a red-critical warning message equivalent to the English
  copy in this workflow.
- Logs include one-command dry-run and `--apply` recovery commands for revert
  and migration.
- Content-integrity logs include dry-run and `--apply` recovery commands for
  `delete-missing-record` only when the reason is `missing_file`.
- The web app shows a red, non-dismissible warning with `Revert config` and
  `Migrate backup` buttons.
- Missing-file content-integrity alerts show `Delete missing memory record`
  instead of path drift actions.
- Revert restores previous `projectPath` and `storePath` in config.
- Migrate moves or copies existing backup data into the configured target
  directory without overwriting conflicts.
- `projectPath` is treated as the backup repository root, separate from the app
  repository.
- Clean first start with backup enabled auto-initializes git under `projectPath`
  when needed.
- Non-clean startup without a git repository warns and does not run `git init`.
- Every backup commit validates that `projectPath` is the git repository root
  before running `git add` or `git commit`.
- If `projectPath` is no longer git-managed, backup stops and creates log and UI
  warnings instead of committing into the wrong repository.
- Push checks for a configured remote before pushing.
- Missing remote skips push without warning.
- Existing remote push failure creates log and UI warnings.
- SQLite database files remain outside `storePath`.
- `storePath` remains inside `projectPath`.

## Verification Commands

Run from the implementation branch:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/config/config.test.ts
mise exec -- bun run test tests/server/backup/backup-environment.test.ts
mise exec -- bun run test tests/server/backup/git-backup.test.ts
mise exec -- bun run test tests/server/routes/api-backup-failsafe.test.ts
mise exec -- bun run test tests/components/backup-failsafe.test.ts
mise exec -- bun run test tests/server/backup/backup-failsafe-cli.test.ts
mise exec -- bun run verify
```

Manual verification:

```text
1. Start with a clean temp TRAUMA config where projectPath is ./data and backup
   is enabled.
2. Confirm startup initializes ./data as a git repository.
3. Add a memory and confirm backup commits locally.
4. Stop the app.
5. Change projectPath and storePath to new paths while the old backup data
   remains.
6. Start the app.
7. Confirm logs show "Backup location changed" with revert and migrate commands.
8. Confirm the web app shows a red non-dismissible alert with Revert config and
   Migrate backup buttons.
9. Use Revert config and confirm the app points back to the previous backup
   paths.
10. Repeat the drift setup and use Migrate backup.
11. Confirm old memory content appears under the new storePath and the alert
   clears after reload.
12. Create a successful backup metadata row whose `CONTENT.md` is missing while
    the stamp still matches current config.
13. Confirm logs and UI show "Backup content is inconsistent" without Revert
    config or Migrate backup actions, and with Delete missing memory record.
14. Confirm Delete missing memory record removes only the orphan SQLite row and
    clears the alert when no other content-integrity issue remains.
15. Create a successful backup metadata row whose `CONTENT.md` exists but is
    untracked and confirm the delete action is not available.
16. Configure push=true with no remote and confirm local commit succeeds without
   warning.
17. Configure a broken remote and confirm push failure creates log and UI
   warnings.
```

## Branching And PR Flow

Historical branch flow for this merged task:

```bash
git switch triage
git pull --ff-only origin triage
git switch -c triage-backup-environment-failsafe
```

The PR targeted the active triage branch at the time. New follow-up work should
branch from the current target branch and use a fresh branch name.

## PR Handoff

The PR description must include:

- Backup environment stamp schema.
- Drift detection rules.
- Clean-state definition.
- First-start git initialization behavior.
- Revert and migrate recovery behavior.
- Remote missing skip behavior.
- Remote push failure warning behavior.
- Exact verification commands and outcomes.
- Manual verification evidence for the red web warning.
