# Trauma Project Instructions

Trauma is a TypeScript bookmark management app. The project domain term is
`memory` for one bookmark and `memories` for the collection.

Start with [docs/INDEX.md](docs/INDEX.md). It is the authoritative map for
current architecture, contracts, operations, and verification. Historical
records are context only and must not override current semantic docs, code, or
tests.

Open durable work belongs in [Backlog.md](Backlog.md). Keep task-specific plans
temporary and move lasting requirements into the owning semantic document.

Commit finalization exclusions for Sawyer live in
[.sawyer/exclude-whitelist.txt](.sawyer/exclude-whitelist.txt).

## Verification

`bun run verify` (docs check, typecheck, Vitest, build) builds into
`.output-verify/` and leaves the served `.output/` untouched. `bun run build`
rewrites `.output/` under the running LaunchAgent, so run it only as part of a
deploy that restarts the service.

UI-affecting work is accepted only on `bun run verify:full`: `verify`, then the
Playwright browser preflight, then the full Playwright suite with no failed and
no unexecuted test.
