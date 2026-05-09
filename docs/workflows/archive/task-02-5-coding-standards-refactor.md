# Task 02.5: Coding Standards Refactor Workflow

Status: archived after PR #3 merge.

## Goal

Validate the merged foundation against the new coding standards and refactor
weak, legacy, vulnerable, or low-readability implementation before larger
feature work continues.

## Required Context

- [Coding standards](../../references/coding-standards/INDEX.md)
- [Technology stack](../../references/technology-stack.md)
- [Configuration reference](../../references/configuration.md)
- [Data and storage architecture](../../architecture/data-and-storage.md)
- [Verification strategy](../../quality/verification.md)
- [Archived Task 01](task-01-project-bootstrap.md)
- [Archived Task 02](task-02-config-persistence.md)

## Ownership

Primary files and directories:

- `tsconfig.json`
- `package.json`
- `src/app.tsx`
- `src/routes/**`
- `src/server/config/**`
- `src/server/db/**`
- `src/server/store/**` if store code is already present on the target branch
- `tests/server/config/**`
- `tests/server/db/**`
- `tests/server/store/**` if store code is already present on the target branch
- `tests/smoke/**`

This is a quality gate, not a feature task. Do not add importer behavior,
reader rendering, highlight behavior, backup behavior, auth, new UI flows, or
new runtime dependencies.

## Audit Commands

Run these before changing code and keep the output in the PR notes:

```bash
rg "any|as any|@ts-ignore|@ts-expect-error|eslint-disable" src tests
rg "unknown|Record<string, unknown>|object|Function" src tests
rg "createEffect|createMemo|splitProps|onCleanup|on\\(" src tests
rg "sql\\.raw|db\\.run|db\\.exec|query\\(|console\\.log" src tests
rg "TODO|FIXME|HACK|temporary|legacy|workaround" src tests docs
```

Allowed matches must be explained. Examples:

- `unknown` is allowed at trust boundaries when narrowed before domain use.
- `Record<string, unknown>` is allowed inside validation helpers.
- raw SQL inside Drizzle schema checks or migrations is allowed when values are
  static and not user-controlled.

## Implementation Steps

1. Validate compiler and package-manager constraints.
   - Confirm `tsconfig.json` keeps `strict`, `noEmit`,
     `noFallthroughCasesInSwitch`, `noImplicitOverride`, and
     `noUncheckedIndexedAccess`.
   - Confirm `package.json` uses Bun as `packageManager`.
   - Confirm no npm, Yarn, or pnpm lockfile is present.
   - Do not change dependency versions unless a failing verification command
     proves the pin is broken.

2. Review and refactor TypeScript boundary typing.
   - Remove `any` and `as any` if found.
   - Keep `unknown` only at external boundaries such as JSON parsing, config
     input, caught errors, filesystem data, request input, or extractor output.
   - Narrow `unknown` with explicit guards before passing values into domain
     code.
   - Replace unsafe type assertions with runtime validation or narrower helper
     return types.
   - Replace non-null assertions with local guards.

3. Review and refactor config safety.
   - Keep JSON config non-executable.
   - Preserve missing-file, invalid-JSON, invalid-shape, and invalid-path
     errors.
   - Keep path resolution centralized.
   - Preserve protection against `storePath` outside `projectPath`.
   - Preserve protection against `databasePath` inside the markdown backup
     store.
   - Add focused tests for any changed validation branch.

4. Review and refactor Drizzle and SQLite boundaries.
   - Keep Drizzle access inside `src/server/db/**`.
   - Keep `src/server/db/schema.ts` as the codebase-first schema source.
   - Confirm schema changes have matching `drizzle/**` migrations.
   - Use Drizzle query APIs or the `sql` tagged template for custom SQL.
   - Do not use `sql.raw()` for request, config, extractor, or user-controlled
     values.
   - Ensure opened SQLite handles are closed in tests, scripts, and failure
     paths.
   - Add repository tests when a repository contract changes.

5. Review and refactor Solid and route code.
   - Remove React-specific patterns if found.
   - Avoid prop destructuring that breaks Solid reactivity.
   - Keep derived values as accessors or pure `createMemo`.
   - Reserve `createEffect` for real side effects only.
   - Register `onCleanup` for listeners, timers, subscriptions, or resources.
   - Keep filesystem, SQLite, git, and extraction code out of client bundles.

6. Review and refactor readability issues.
   - Split functions that mix parsing, validation, transformation,
     persistence, and rendering.
   - Replace deeply nested branches with early returns where behavior stays
     clearer.
   - Replace boolean flag APIs with explicit options or discriminated unions
     when a function has multiple modes.
   - Keep module boundaries small; do not move unrelated feature code.

7. Preserve behavior with targeted tests.
   - Update existing tests only when the refactor changes public behavior or
     a test encoded an unsafe assumption.
   - Add regression tests for fixed vulnerabilities or validation gaps.
   - Keep tests deterministic and filesystem-isolated.

8. Produce a PR audit summary.
   - List each standards violation found.
   - Mark each item as fixed, intentionally allowed, or out of scope.
   - Include exact verification commands and outcomes.

## Acceptance Criteria

- `rg "any|as any|@ts-ignore|@ts-expect-error|eslint-disable" src tests`
  returns no matches, or every match is explicitly justified in the PR.
- `unknown` is limited to boundary handling and is narrowed before domain use.
- Indexed access introduced by the codebase is guarded before use.
- Drizzle and SQLite access remains server-side and repository-scoped.
- No package-manager drift or new runtime dependencies are introduced.
- No feature behavior is added beyond refactors and regression tests.
- The codebase passes the verification commands below.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
git diff --check
```

Run E2E only if UI, route, build entrypoint, or app-shell code changes:

```bash
bun run test:e2e
```

## PR Handoff

The PR description must include:

- Audit command outputs or a concise summary of matches.
- Standards violations fixed.
- Allowed matches that remain and why they are safe.
- Files refactored.
- Exact verification commands and outcomes.
- Confirmation that no feature scope was added.
