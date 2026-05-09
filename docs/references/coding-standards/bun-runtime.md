# Bun Runtime Rules

## Package Manager

- MUST use Bun as the package manager and keep `bun.lock` committed.
- MUST NOT introduce `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- MUST keep `@types/bun` available for Bun runtime APIs.
- MUST NOT switch from Vitest to Bun's test runner without a specific design
  update. Bun is the runtime/package manager here; Vitest remains the selected
  unit test runner.

## Runtime Boundaries

- MUST keep runtime-only APIs out of client bundles.
- MUST treat Bun-only modules as Bun-only unless a complete alternate runtime
  adapter is intentionally designed, implemented, and tested.
- MUST use upstream Bun runtime types such as
  `typeof import("bun:sqlite").Database` instead of maintaining local narrowed
  constructor shapes.
- MUST centralize lifecycle for Bun SQLite connections and other opened
  resources.
- MUST close database handles in tests, scripts, one-shot tools, and failure
  paths.
- MUST NOT keep Node or proxy fallback code for Bun APIs when that fallback is
  not covered by the same behavior tests as the Bun path.
- SHOULD use Bun runtime APIs only where they reduce maintenance or match the
  selected stack boundary.
