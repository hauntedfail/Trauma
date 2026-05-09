# Coding Standards

This document defines Trauma's implementation rules for TypeScript, SolidStart,
and server-side persistence code.

The project uses ECC common rules and TypeScript extensions as strict defaults.
When a generic ECC rule conflicts with Trauma's stack, this document wins. The
most important stack-specific override is that Trauma is SolidStart/Solid, not
React.

## Rule Levels

- MUST: review blocker unless the PR explains a narrow, necessary exception.
- SHOULD: default approach. Deviations need a short reason in the PR.
- AVOID: recognized smell. Treat as forbidden unless the alternative is worse
  and the PR explains why.

## Implementation Values

Trauma favors clean, boring implementation over cleverness.

- Keep modules small, cohesive, and domain-oriented.
- Make data ownership obvious.
- Prefer explicit contracts over inference from incidental behavior.
- Avoid hidden side effects and implicit runtime coupling.
- Preserve local-first operation and low maintenance cost.
- Prefer early returns, named helpers, and linear control flow over deeply
  nested conditionals.
- Keep parsing, validation, transformation, persistence, and rendering as
  separate phases.
- Prefer discriminated options objects over boolean flag APIs when a function
  has more than one mode.

## Type Safety

- MUST keep TypeScript `strict` clean.
- MUST keep the strict compiler options used by the project, including
  `noFallthroughCasesInSwitch`, `noImplicitOverride`, and
  `noUncheckedIndexedAccess`.
- MUST treat indexed access and map/object lookups as possibly missing. Narrow
  or guard the value before use instead of adding non-null assertions.
- MUST NOT use `any`, `as any`, or implicit `any`.
- MUST NOT export APIs whose caller must pass or receive `unknown`.
- MUST treat `unknown` as a boundary type only. It is appropriate for
  `catch` bindings, parsed JSON, external extractor output, config file input,
  request bodies, and other untrusted values.
- MUST narrow or validate `unknown` before using it or passing it into domain
  code.
- MUST NOT use type assertions to bypass validation. Assertions are acceptable
  only when a prior runtime check established the invariant and the assertion is
  kept local.
- SHOULD prefer discriminated unions and string literal unions over loose
  strings or untyped status values.
- SHOULD use `satisfies` for object literals that must conform to a contract
  without losing literal precision.
- SHOULD use `import type` for type-only imports.
- AVOID non-null assertions. If one is unavoidable, keep it local to the
  invariant and make the invariant obvious.
- AVOID broad domain types such as `{}`, `object`, `Function`, or
  `Record<string, unknown>`. `Record<string, unknown>` is acceptable inside
  validation helpers before a value is narrowed.

## Boundary Validation

- MUST validate all data crossing a trust boundary before domain use.
- MUST validate route params, query params, form bodies, JSON bodies, config
  files, environment values, filesystem paths, markdown frontmatter, external
  fetch responses, and extractor output.
- MUST fail fast with clear errors when config, persistence, or import input is
  invalid.
- MUST keep validation close to the boundary, then pass typed values inward.
- SHOULD use schema-based validation when the shape is non-trivial.

## SolidStart And UI Code

- MUST NOT introduce React-specific assumptions, hooks, router APIs, or state
  patterns.
- MUST keep server-only code out of client bundles. Filesystem, SQLite, git, and
  extraction code belong behind server modules or server functions.
- MUST NOT use Solid `createEffect` for derived state, data transformation, or
  user-triggered actions.
- MUST reserve `createEffect` for real side effects such as subscriptions,
  external integrations, or DOM/browser APIs that cannot be represented as
  declarative JSX.
- MUST use plain accessors/functions or `createMemo` for derived values.
- MUST keep `createMemo` pure. Do not call setters, mutate state, fetch, write
  storage, or trigger external effects from a memo.
- MUST put explicit user actions in event handlers or server actions, not in an
  effect that happens to observe state.
- MUST NOT destructure Solid props in a way that breaks reactivity. Use
  accessors such as `() => props.value` or `splitProps` when props need to be
  grouped.
- MUST register `onCleanup` for event listeners, timers, subscriptions, or
  resources created inside components or reactive scopes.
- MUST pass accessor functions to Solid's `on` utility for store properties,
  such as `on(() => state.value, handler)`.
- SHOULD use route data, server functions, or `createResource` for async data
  loading depending on whether the data is server-owned or client-only.
- SHOULD keep components mostly presentational. Move persistence, extraction,
  markdown, and backup behavior into server/domain modules.
- AVOID component-level duplication of server state. Derive view state from
  route data, params, query state, or local UI signals.

## State And Data Ownership

- MUST keep canonical ownership clear:
  - SQLite owns metadata.
  - Markdown files own extracted readable content.
  - The UI owns transient presentation state.
- MUST NOT duplicate canonical state across SQLite and markdown unless a
  documented sync rule says which side wins.
- MUST update data immutably in UI and domain transformations.
- MUST model status fields as explicit unions and enforce persisted constraints
  where possible.
- SHOULD prefer small DTOs at module boundaries rather than leaking ORM rows
  through the entire app.

## Server And Persistence Boundaries

- MUST keep Drizzle access inside server-side persistence modules.
- MUST NOT query SQLite directly from route components or client code.
- MUST use parameterized Drizzle/SQL APIs. Never interpolate user input into SQL.
- MUST use Drizzle's `sql` tagged template for custom SQL expressions. Use
  `sql.raw()` only for static, locally defined SQL fragments.
- MUST keep `src/server/db/schema.ts` as the codebase-first schema source of
  truth.
- MUST commit schema changes with matching migrations and metadata.
- MUST use `bun run db:generate` and review the generated SQL for schema
  changes. Do not use push-style schema mutation for reviewable project
  migrations.
- MUST define both database-level constraints and Drizzle relations when a table
  relationship is part of the domain model.
- MUST wrap multi-table or multi-step writes in transactions. Memory creation,
  tag/category association, highlight persistence, and backup status updates
  must not partially commit.
- MUST keep SQLite database files outside the markdown backup store.
- MUST keep Bun SQLite connection lifecycle centralized. Tests, scripts, and
  one-shot tools must close opened database handles.
- MUST resolve and validate configured paths before filesystem writes.
- MUST prevent path traversal when reading or writing markdown content.
- SHOULD expose repository methods that match domain use cases rather than
  generic table access.
- AVOID adding external services, queues, managed databases, or auth/user
  ownership unless a later design explicitly adds them.

## Markdown, HTML, And Reader Safety

- MUST treat extracted article content as untrusted input.
- MUST sanitize rendered markdown or HTML before it reaches the browser.
- MUST NOT use raw HTML injection without a sanitizer and a local explanation.
- MUST preserve highlight markers through deterministic markdown transforms.
- SHOULD keep markdown transform functions pure and covered by focused tests.

## Error Handling

- MUST handle errors explicitly at trust boundaries and persistence boundaries.
- MUST NOT silently swallow errors or return empty values that hide failures.
- MUST expose user-safe messages to UI code and keep diagnostic detail on the
  server side.
- MUST narrow caught errors from `unknown` before reading properties.
- SHOULD use typed error classes or discriminated error results for recoverable
  domain failures.
- AVOID catch-all `try/catch` blocks that mix unrelated operations.

## Security

- MUST NOT hardcode secrets, tokens, credentials, or private local paths.
- MUST keep `.env*` secrets untracked.
- MUST validate URL protocols before importer fetches. `http:` and `https:` are
  the only expected initial protocols.
- MUST prevent XSS in markdown and extracted content rendering.
- MUST avoid leaking stack traces, filesystem paths, or raw dependency errors to
  browser-visible responses.
- MUST keep auth assumptions out of the initial implementation. If auth is
  introduced later, it needs a separate design and threat model.

## Tests And Verification

- MUST include tests with behavior changes.
- MUST cover storage, importer, markdown, highlight, backup, routing, and reader
  changes with either focused tests or Playwright coverage.
- MUST run `bun run typecheck` for TypeScript-facing changes.
- MUST run relevant verification before handoff and record exact commands and
  outcomes.
- MUST NOT weaken or delete tests to make a change pass unless the test is
  wrong and the PR explains the correction.
- SHOULD write deterministic tests with local fixtures, especially for
  extraction and markdown rendering.
- SHOULD prefer focused tests for pure transforms and repositories, then E2E for
  user workflows.

## Dependencies

- MUST justify every new runtime dependency in the PR.
- MUST prefer existing stack tools: Bun, SolidStart, Solid, Drizzle, Vitest, and
  Playwright.
- MUST use Bun as the package manager and keep `bun.lock` committed.
- MUST NOT introduce `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- MUST keep `@types/bun` available for Bun runtime APIs.
- MUST NOT switch from Vitest to Bun's test runner without a specific design
  update. Bun is the runtime/package manager here; Vitest remains the selected
  unit test runner.
- MUST NOT add large frameworks, state libraries, UI kits, queues, or service
  SDKs unless the task design explicitly calls for them.
- SHOULD prefer standard APIs or small local utilities when they keep the
  maintenance surface smaller.

## Logging And Diagnostics

- MUST NOT leave `console.log` in production code.
- SHOULD use structured server-side diagnostics once a logging helper exists.
- SHOULD keep debug output behind tests, debug scripts, or explicit development
  paths.
- AVOID noisy logging in request paths, import loops, or backup hooks.

## Clean Code Anti-Patterns

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

## Exception Policy

Exceptions are allowed only when they are narrow, intentional, and reviewable.
The PR must state:

- Which rule is being bypassed.
- Why the clean default is worse in this case.
- How the exception is constrained.
- What verification was run.

## Research Basis

These rules are grounded in the official docs for the active stack:

- Bun TypeScript compiler options, Bun type definitions, lockfile handling, and
  SQLite connection behavior.
- TypeScript `unknown` and strict indexed access behavior.
- Solid props reactivity, memo purity, cleanup lifecycle, and `on` utility
  behavior.
- Drizzle codebase-first migrations, relations, transactions, and `sql`
  template usage.
