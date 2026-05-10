# Anti-Patterns

These are prohibited by default:

- `any`, `as any`, and exported `unknown`.
- `createEffect` used to derive state or trigger user actions.
- React hooks or React router patterns.
- Route components that contain persistence or extraction logic.
- Direct SQLite access outside persistence modules.
- String-built SQL with user-controlled values.
- Unvalidated config, request, or extractor data.
- Unsanitized markdown or HTML rendering.
- Mutable updates to shared objects or arrays.
- Large files that mix UI, persistence, and domain behavior.
- Deep nesting instead of early returns and small functions.
- Boolean flag APIs that hide multiple modes.
- Magic strings for status, route, config, or table names.
- Catching errors and returning `null`, `undefined`, or `[]` without preserving
  failure information.
- Adding dependencies to avoid writing a small, clear local function.
- Package manager drift through npm, Yarn, or pnpm lockfiles.
- Push-style database schema mutation that bypasses committed migrations.
- `sql.raw()` with request, config, extractor, or user-controlled input.
- Duplicated domain value lists across types, guards, schema checks, migrations,
  parsers, fixtures, or UI filters.
- Fake cross-runtime fallbacks where one runtime path is typed or cast to look
  compatible without a tested adapter contract.
- Exposing repositories or clients before migrations, constraints, and schema
  invariants are applied.
- Resolving bundled migrations, fixtures, or config-relative paths from
  incidental `process.cwd()` when the contract needs a stable base.
- Runtime migration runners that accept unknown/newer applied migration rows or
  skip applied-hash validation.
- Migration runners that commit schema changes separately from the row that
  records the migration as applied.
- Disabling SQLite foreign-key checks for generated migrations by removing the
  rollback transaction around ordinary DDL/DML.
- Predictable temp-file names, non-cleaned temp files, or file replacement code
  that assumes one OS rename behavior without a fallback.
- Markdown/frontmatter parsing that assumes LF-only files, no UTF-8 BOM, or a
  trailing newline after frontmatter.
- Error messages that use internal TypeScript property names when the failing
  artifact uses serialized field names.
- PR-specific review history in coding standards or architecture docs.
- Prose-only guardrails for defects, style issues, or invariants that can be
  enforced by tests, static checks, or tool configuration.
- Force-push, remote history rewrite, or destructive ref updates without
  current-task user authorization.
