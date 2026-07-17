# Verification Strategy

TRAUMA uses layered, risk-based verification. Focused tests prove domain
invariants; Playwright proves cross-boundary user behavior.

## Standard Commands

```bash
bun run typecheck
bun run test
bun run build
bun run dev:smoke
bun run test:e2e
```

`bun run docs:check` validates documentation links, indexed reachability,
retired active terminology, and chronology boundaries. `bun run verify` runs
that documentation check, typecheck, unit/integration tests, and the production
build. `bun run dev:smoke` is the deterministic startup probe.
`bun run test:e2e` is the full Playwright suite, not the startup smoke check.

Run `bun run audit` for dependency changes and security reviews. CI keeps the
audit separate from `bun run verify` so the normal typecheck, test, and build
loop remains network-independent.

The audit ignores `GHSA-67mh-4wv8-2f99` and `GHSA-g7r4-m6w7-qqqr`. Their
affected `esbuild` versions are transitive build-tool dependencies of
`@esbuild-kit/core-utils` and `tsx`; those consumers use transforms, not
esbuild's vulnerable development-server API. A global `esbuild` override is
unsafe because Vinxi, Vite, Nitro, and the database tools require different
release lines. Recheck the reachability and remove each exception when its
upstream dependency advances.

Run focused tests while iterating, then use the broad commands appropriate to
the changed risk. Tests and E2E must use fixtures and temporary database,
store, and git paths rather than external websites or real application data.

## Current E2E Risk Coverage

- `e2e/bootstrap.spec.ts`: basic application boot and shell availability.
- `e2e/add-memory.spec.ts`: public composer submission, successful extraction,
  link-only fallback, reader projection, SQLite/store persistence, and local git
  backup completion.
- `e2e/browse-shell.spec.ts`: canonical redirects, query/filter/read state,
  pagination, memory actions, taxonomy, keyboard navigation, shell popovers, and
  desktop/tablet/phone chrome.
- `e2e/cross-device-responsive.spec.ts`: responsive navigation, safe-area and
  overflow behavior, theme controls, and primary-action reachability.
- `e2e/collection-pagination.spec.ts`: large SQLite/store archives, stable
  Flashback/Moment current-page DOM, URL Reload/Back, and Reader All rail-local
  pagination and scroll bounds.
- `e2e/reader.spec.ts`: source reader, translation controls, deletion,
  Flashbacks, Moments, table-of-contents behavior, and Psychiatrist
  streaming/resume/cancel/regenerate/permission flows.
- `e2e/security-boundaries.spec.ts`: hostile Host rejection, configured
  loopback acceptance, and backup reconciliation GET non-exposure.
- `e2e/settings.spec.ts`: model-catalog recovery, saved-default preservation,
  retry focus, and cancellation-safe Codex auth polling.

The Add Memory fixture seam is owned by `src/server/importer/runtime.ts`. It is
enabled only by Playwright's three fixed E2E guards and synthesizes results for
two exact reserved `.invalid` URLs without network I/O. Custom hosts, paths,
query strings, userinfo, and content cannot enter the seam; every non-exact URL
uses the production SSRF validation and pinned-fetch importer.

## Focused Test Ownership

Use focused tests for the smallest affected boundary:

- `tests/server/config/**`, `db/**`, and `store/**`: config, migrations,
  repositories, and filesystem ownership.
- `tests/server/importer/**`, `browser-import/**`, and `memories/**`: public
  URL policy, extraction, add/delete compensation, and browse behavior.
  Import admission coverage proves overflow is rejected before body/fetch work
  and that timeout, validation, and failure paths release capacity.
- `tests/server/reader/**`, `flashbacks/**`, and route tests: sanitization,
  reader hashes, variant-local ranges, Moments, and API validation.
- `tests/server/browse/**` and collection route tests: opaque cursor validation,
  stable keyset ordering, bounded stale-row scans, distinct content/TOC reads,
  legacy API compatibility, and paged envelopes.
- `tests/server/translation/**`: job state, chunking, Codex protocol,
  serialized event admission, retry/job cumulative budgets, replay/SSE
  backpressure, cancellation races, stitching, projections, and current-output
  resolution. It also covers probe-client closure before queueing and absolute
  per-segment/per-chunk UTF-8 output admission. Shared Codex byte-limit changes also run the adjacent Psychiatrist
  event-persistence and SSE suites.
- `tests/server/psychiatrist/**` plus `tests/skills/**`: runtime isolation,
  prompt policy, file-backed thread state, events, citations, route semantics,
  and shared active-plus-reserved turn capacity.
- `tests/server/backup/**` and backup route/component tests: identity stamps,
  content integrity, recovery, queue behavior, and push failure.
- `tests/components/**` and `tests/scripts/frontend-refine-tokens.test.ts`:
  UI contracts that are cheaper and more deterministic than browser tests.

Tests for persisted data must use real Bun SQLite and temporary files where the
runtime behavior depends on them. Pure parsing/transformation tests should stay
deterministic and avoid server startup.

## Startup And Release

`bun run dev:smoke` boots a server on an explicit host/port, probes
`/memories`, and fails on bind fallback, early exit, or timeout. Use it after
runtime, config, build-tool, or startup-script changes.

CI and tagged releases run `bun run verify` and `bun run test:e2e`. Release
tags are three-part numeric semantic versions with an optional leading `v`,
for example `0.3.0` or `v0.3.0`.

## Completion Bar

- Behavior changes include regression coverage at the owning boundary.
- Storage, security, import, translation, Psychiatrist, backup, routing, or
  reader changes run focused tests plus the broad checks justified by risk.
- Browser-visible layout or interaction changes run Playwright.
- Documentation-only changes run `bun run docs:check`; a dedicated lightweight
  CI workflow runs for documentation paths.
- Verification commands and exact outcomes are recorded at handoff.
- Tests are never weakened merely to make a change pass.

For accepted review findings, follow the canonical
[review feedback policy](../references/coding-standards/review-feedback-policy.md)
instead of duplicating review procedure here.
