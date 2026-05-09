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
- Force-push, remote history rewrite, or destructive ref updates without
  current-task user authorization.
