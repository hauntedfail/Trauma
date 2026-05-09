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
- MUST centralize lifecycle for Bun SQLite connections and other opened
  resources.
- MUST close database handles in tests, scripts, one-shot tools, and failure
  paths.
- SHOULD use Bun runtime APIs only where they reduce maintenance or match the
  selected stack boundary.
