# Trauma Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Trauma foundation so large feature workers can start from a stable SolidStart/Bun/SQLite baseline.

**Architecture:** Trauma is one SolidStart app running on Bun. Server code must stay split by domain: config, DB repositories, importer, markdown store, backup queue, reader pipeline, and UI shell. SQLite owns runtime metadata; markdown files under `storePath` own readable memory content.

**Tech Stack:** TypeScript, SolidStart, Solid, Bun, Drizzle ORM, SQLite, Playwright, Vitest.

---

## Worker Domain Map

Workers should own one coherent domain per pull request. Do not split by tiny
component files. Do not mix unrelated domains in one PR.

| Order | Task | Domain | Depends On | Primary Docs |
| --- | --- | --- | --- | --- |
| 1 | Project Bootstrap / Toolchain | app scaffold, dependency graph, scripts, verification baseline | none | `docs/references/technology-stack.md`, `docs/quality/verification.md` |
| 2 | Config + Persistence Foundation | config loader, path validation, Drizzle schema, migrations, repositories | 1 | `docs/references/configuration.md`, `docs/architecture/data-and-storage.md` |
| 3 | Markdown Store Contract | `CONTENT.md` writer/reader, frontmatter, path resolution, store fixtures | 1, 2 interfaces | `docs/architecture/data-and-storage.md` |
| 4 | Importer + Add Memory Flow | URL extraction, link-only fallback, add memory server action/API | 2, 3 | `docs/architecture/flows.md` |
| 5 | Browse Shell + List Filters | `/`, `/memories`, shell layout, list/grid, filters, drawers | 1, 2 | `docs/architecture/ui-and-routing.md` |
| 6 | Reader Pipeline | `/memories/:id`, markdown render, sanitize, GFM, anchors, ToC, embeds | 3, 5 | `docs/architecture/ui-and-routing.md` |
| 7 | Highlight System | selection UI, optimistic persistence, highlight DB rows, mark insertion | 2, 3, 6 | `docs/architecture/data-and-storage.md`, `docs/architecture/flows.md` |
| 8 | Git Backup Queue | in-process queue, git stage/commit/push, retry, backup status | 2, 3, 4, 7 | `docs/architecture/flows.md`, `docs/operations/local-self-hosting.md` |
| 9 | E2E Integration Hardening | deterministic fixtures, full Playwright flows, verification command | 4, 5, 6, 7, 8 | `docs/quality/verification.md` |

## Task 1: Project Bootstrap / Toolchain

**Files:**
- Create: `package.json`
- Create: `bun.lock`
- Create: `app.config.ts`
- Create: `tsconfig.json`
- Create: `src/app.tsx`
- Create: `src/entry-client.tsx`
- Create: `src/entry-server.tsx`
- Create: `src/server/db/schema.ts`
- Create: `src/routes/index.tsx`
- Create: `src/routes/memories/index.tsx`
- Create: `src/styles/app.css`
- Create: `tests/smoke/app.test.ts`
- Create: `e2e/bootstrap.spec.ts`
- Create: `playwright.config.ts`
- Create: `vitest.config.ts`
- Create: `drizzle.config.ts`
- Create: `trauma.config.example.json`
- Modify: `.gitignore`
- Modify: `docs/INDEX.md`

- [x] **Step 1: Create the implementation plan**

Save this file at `docs/superpowers/plans/2026-05-09-trauma-foundation-implementation.md`.

- [x] **Step 2: Scaffold SolidStart with Bun**

Run:

```bash
bun create solid@latest
```

Use the current repository root as the target and select a TypeScript stable
SolidStart starter. If the generator cannot run in a non-empty directory,
generate into a temporary directory and copy the SolidStart scaffold files into
the repository without overwriting `docs/` or `AGENTS.md`.

Expected:

- SolidStart app entrypoints exist under `src/`.
- `app.config.ts` exists and imports `defineConfig` from `@solidjs/start/config`.
- `package.json` uses Bun-compatible scripts.

- [x] **Step 3: Add baseline dependencies**

Install the runtime and development dependencies needed by foundation workers:

```bash
bun add drizzle-orm @solidjs/meta @solidjs/router
bun add -d drizzle-kit @types/bun typescript vitest @vitest/coverage-v8 @playwright/test
```

Expected:

- `package.json` contains the dependencies.
- `bun.lock` is updated.

- [x] **Step 4: Normalize package scripts**

Ensure `package.json` contains these scripts:

```json
{
  "scripts": {
    "dev": "vinxi dev",
    "build": "vinxi build",
    "start": "vinxi start",
    "preview": "vinxi preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "verify": "bun run typecheck && bun run test && bun run build"
  }
}
```

Expected:

- Workers can run one command, `bun run verify`, for baseline checks.
- E2E remains separate as `bun run test:e2e` because it needs a served app.

- [x] **Step 5: Add minimal baseline app**

Create a minimal route skeleton:

- `/` redirects or links to `/memories`.
- `/memories` renders the Trauma shell baseline and a "No memories yet" state.

Expected:

- The app has no business implementation yet.
- The page confirms the scaffold is runnable.

- [x] **Step 6: Add baseline config files**

Create:

- `vitest.config.ts` for unit tests.
- `playwright.config.ts` for E2E tests against the dev server.
- `drizzle.config.ts` with baseline schema/migrations paths.
- `trauma.config.example.json` matching `docs/references/configuration.md`.

Expected:

- Future workers do not need to re-decide tool locations.

- [x] **Step 7: Add smoke tests**

Create:

- A Vitest smoke test that proves test discovery works.
- A Playwright smoke test that visits `/memories` and sees "Trauma".

Expected:

- `bun run test` passes without app server.
- `bun run test:e2e` can run once the dev server is available.

- [x] **Step 8: Verify bootstrap**

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Expected:

- All commands exit `0`.

- [x] **Step 9: Commit bootstrap**

Run:

```bash
git add package.json bun.lock app.config.ts tsconfig.json src tests e2e playwright.config.ts vitest.config.ts drizzle.config.ts trauma.config.example.json .gitignore docs
git commit -m "chore: bootstrap trauma app"
```

Expected:

- The commit contains only bootstrap/toolchain and plan updates.

## Task 2: Config + Persistence Foundation

**Ownership:** `src/server/config/**`, `src/server/db/**`, Drizzle schema,
migrations, and repository contracts.

**Acceptance criteria:**

- `trauma.config.json` loader validates static JSON config.
- `storePath` inside `projectPath` is enforced.
- SQLite initialization uses Drizzle's Bun SQLite support.
- Schema covers memories, tags, categories, joins, and highlights.
- Unit/integration tests cover valid config, invalid path relationships, and
  repository creation.

**Verification:** `bun run typecheck`, `bun run test`, and migration generation.

## Task 3: Markdown Store Contract

**Ownership:** `src/server/store/**` and store-specific tests.

**Acceptance criteria:**

- Store writer creates `{storePath}/memories/{uuid-v7}/CONTENT.md`.
- Frontmatter includes `id`, `url`, `title`, `captured_at`, and
  `extraction_status`.
- Store reader returns parsed frontmatter and markdown body.
- Tests use temporary directories and do not write into the repository data
  store.

**Verification:** `bun run test` with filesystem-isolated tests.

## Task 4: Importer + Add Memory Flow

**Ownership:** `src/server/importer/**`, add memory server action/API, and
import flow tests.

**Acceptance criteria:**

- URL-only add flow creates a UUID v7 memory.
- Readability-style extraction maps success into metadata and markdown.
- Failed extraction creates a link-only memory with status and error.
- Raw HTML is not persisted.

**Verification:** importer unit tests and one integration test that creates a
memory from a deterministic fixture URL or mocked fetch.

## Task 5: Browse Shell + Memory List / Filters

**Ownership:** app shell components, `/`, `/memories`, query filter UI, and
responsive drawers.

**Acceptance criteria:**

- `/` routes to `/memories`.
- `/memories` supports `q`, `category`, `tag`, and `view` query state.
- Desktop shell has left nav, center content, and right filter panel.
- Narrow screens use left and right drawers.

**Verification:** component tests where useful plus Playwright coverage for
route rendering and filter query behavior.

## Task 6: Reader Pipeline

**Ownership:** `/memories/:id`, `src/server/reader/**`, markdown rendering
pipeline, and sanitizer tests.

**Acceptance criteria:**

- Reader loads `CONTENT.md` and renders read mode.
- Pipeline supports GFM, syntax highlight, sanitization, footnotes, heading
  anchors, ToC, controlled embeds, and highlight marks.
- Unsafe HTML/scripts are rejected while `mark[data-highlight-id]` is allowed.

**Verification:** reader unit tests and Playwright coverage for one rendered
fixture memory.

## Task 7: Highlight System

**Ownership:** highlight UI behavior, highlight repository functions, markdown
mark insertion, and persistence tests.

**Acceptance criteria:**

- Selecting reader text creates an optimistic highlight.
- Server persists `text`, `prefix`, `suffix`, `start_offset`, and `end_offset`.
- `CONTENT.md` receives `<mark data-highlight-id="...">selected text</mark>`.
- Failed persistence rolls back or flags the optimistic highlight.

**Verification:** unit tests for mark insertion and Playwright coverage for
selection-to-persistence behavior.

## Task 8: Git Backup Queue

**Ownership:** `src/server/backup/**`, backup status metadata integration, and
backup tests.

**Acceptance criteria:**

- In-process queue runs sequentially.
- Backup uses `projectPath` as cwd and stages only files under `storePath`.
- Commit and push behavior follows `trauma.config.json`.
- Startup retry re-enqueues eligible pending or failed work.
- Backup failures do not roll back memory/highlight creation.

**Verification:** tests use a temporary git repository and do not push to a real
remote.

## Task 9: E2E Integration Hardening

**Ownership:** `e2e/**`, deterministic fixtures, and verification scripts.

**Acceptance criteria:**

- Playwright covers add memory success, link-only fallback, markdown creation,
  list rendering, reader rendering, category/tag filtering, highlight
  persistence, and backup status display.
- Test DB/store state is isolated per run.
- Verification commands and expected outputs are documented.

**Verification:** `bun run test:e2e` passes on a clean checkout after bootstrap
and feature tasks are complete.

## Plan Self-Review

- Spec coverage: all architecture modules from `docs/architecture/overview.md`
  map to tasks above.
- Storage coverage: SQLite, markdown store, highlights, and backup are separate
  domains with clear dependencies.
- UI coverage: shell, route, reader, and highlight UI are separate tasks to
  prevent oversized PRs.
- Verification coverage: baseline checks start in Task 1; full flow hardening
  is Task 9.
