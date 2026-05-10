# Task 16: Red Call Runtime Triage Workflow

## Goal

Restore trust in local runtime behavior before broader refactoring. The first
target is the broken environment contract: project-root `.env` values must drive
dev/start commands, server runtime selection, E2E startup, and server-side config
loading consistently.

## Current Evidence

- Local `.env` sets `HOST=127.0.0.1`, `PORT=9999`, and
  `TRAUMA_HMR_PORT=9911`.
- `mise exec -- bun --print 'process.env.HOST + ":" + process.env.PORT'`
  reads `.env` and prints `127.0.0.1:9999`.
- `mise exec -- bun run dev` starts Vinxi at `http://127.0.0.1:3000/`.
  This proves `.env` is not reaching the `vinxi dev` subprocess from the
  package script.
- `HOST=127.0.0.1 PORT=9999 TRAUMA_HMR_PORT=9911 mise exec -- bun run dev`
  starts at `http://127.0.0.1:9999/`. Vinxi honors exported variables when they
  actually reach the process.
- `mise exec -- bun --bun run dev` starts at `http://127.0.0.1:9999/`. Bun's
  `--bun` mode is the current minimal evidence-backed path for forcing the
  `vinxi` node-shebang package to run under Bun while preserving `.env`.
- `mise exec -- bun run dev:smoke` passes because the smoke script is a Bun
  process and explicitly forwards host, port, HMR port, and fixtures mode to its
  child process.
- `mise exec -- bun run test:e2e` currently fails 4 of 10 tests. The reader
  route crashes with `Cannot find module 'bun:sqlite'`, showing that the E2E
  web server can execute server code in Node instead of Bun.
- `TRAUMA_CONFIG_PATH` is read by the reader route helper, but browse and add
  memory API paths call `loadTraumaConfig()` without the env path. Runtime config
  loading is split across server modules.

## Priority Order

1. **P0: Runtime command contract**
   - `bun run dev` must run Vinxi under Bun and honor `.env` `HOST`, `PORT`, and
     `TRAUMA_HMR_PORT`.
   - `bun run start` and `bun run preview` must not accidentally use Node for
     server code that depends on `bun:sqlite`.
   - Playwright's web server must use the same Bun runtime rule.

2. **P0: Single server config path contract**
   - Server modules must resolve `TRAUMA_CONFIG_PATH` through one shared helper.
   - Reader, browse, add-memory API, and future server modules must not each
     decide config path behavior independently.

3. **P1: E2E failure triage after runtime fix**
   - Re-run `bun run test:e2e` after the runtime command fix.
   - Treat remaining failures as real UI or routing defects, not as config
     fallout.
   - Do not mask DB/runtime failures as fixture empty states.

4. **P1: Smoke and verification alignment**
   - `bun run dev:smoke` should exercise the same runtime command path as
     `bun run dev`, while still using fixtures mode to avoid mutating the real
     database.
   - Verification docs and CI must describe the real commands that workers run.

5. **P2: Documentation correction**
   - README, `.env.example`, and local self-hosting docs must stop claiming that
     `.env` reaches `vinxi` directly through package scripts unless the scripts
     enforce that behavior.

## Scope

Primary implementation files:

- `package.json`
- `scripts/dev-smoke.ts`
- New script helper under `scripts/` for runtime env parsing and Vinxi command
  execution.
- `playwright.config.ts`
- `src/server/config/**`
- `src/server/memories/browse.ts`
- `src/routes/api/memories.ts`
- `src/server/reader/page-data.ts`
- Focused tests under `tests/server/config/**`, `tests/server/memories/**`, and
  script-related test files.
- README and docs only where command behavior changes.

Out of scope:

- Markdown reader library selection or decomposition.
- Importer extraction behavior.
- Database schema redesign.
- UI redesign beyond fixing E2E-proven interaction or routing defects.
- Git backup queue implementation.

## Implementation Strategy

### Phase 1: Make server commands deterministic

- Add a small script-side runtime env module that validates:
  - `HOST`: non-empty string, default `127.0.0.1`.
  - `PORT`: integer in `1..65535`, default `3000`.
  - `TRAUMA_HMR_PORT`: integer in `1..65533`, default `24678`.
- Add a Vinxi runner script that invokes Vinxi through Bun runtime, not the
  package's Node shebang path.
- Update package scripts so `dev`, `start`, and `preview` go through that runner
  or use an equivalently explicit `bun --bun x vinxi ...` command.
- Keep `build` as low-risk unless evidence shows build-time runtime mismatch.
- Update `dev:smoke` to share the same env parsing and Bun runtime rule instead
  of maintaining a separate startup contract.

### Phase 2: Centralize server config loading

- Add a shared server-side helper for runtime config loading, for example
  `loadRuntimeTraumaConfig()`.
- The helper must call `loadTraumaConfig({ configPath:
  process.env.TRAUMA_CONFIG_PATH })`.
- Replace direct `loadTraumaConfig()` calls in browse and add-memory API paths.
- Keep explicit `options.config` injection in tests and pure domain helpers.
- Add regression tests proving `TRAUMA_CONFIG_PATH` is respected outside reader
  routes.

### Phase 3: Repair E2E failures by evidence

- Re-run E2E after Phases 1 and 2.
- If the reader route still fails, investigate DB initialization and fixture
  creation first.
- If browse query state still fails, inspect hydration timing, event handling,
  and navigation calls in `MemoryBrowse`.
- If link navigation still fails, inspect route ownership and catch-all
  interaction before changing UI components.

### Phase 4: Align docs and CI

- Update `.env.example`, README, and operations docs to match the enforced
  command behavior.
- Ensure CI runs the same commands users run locally, or clearly documents why a
  CI command is intentionally different.
- Keep `AGENTS.md` unchanged unless it needs a short pointer to a new durable
  workflow or reference doc.

## Acceptance Criteria

- With project-root `.env` setting `PORT=9999`, `bun run dev` starts on
  `http://127.0.0.1:9999/`.
- `bun run dev:smoke` passes using the same runtime rule as `bun run dev`.
- Playwright web server runs Trauma server code under Bun, and reader routes no
  longer crash with `Cannot find module 'bun:sqlite'`.
- `TRAUMA_CONFIG_PATH` is honored by reader, browse, and add-memory API server
  paths.
- `bun run verify` passes.
- `bun run test:e2e` passes, or remaining failures are isolated into follow-up
  workflow docs with exact reproduction and root cause.
- Docs match actual command behavior.

## Verification Commands

Run from the `triage` branch:

```bash
mise exec -- bun run verify
mise exec -- bun run dev:smoke
mise exec -- bun run test:e2e
```

Manual startup check:

```bash
PORT=9999 HOST=127.0.0.1 TRAUMA_HMR_PORT=9911 mise exec -- bun run dev
```

Expected manual startup URL:

```text
http://127.0.0.1:9999/
```
