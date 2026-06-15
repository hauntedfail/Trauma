# Verification

Run from `/private/tmp/trauma-task24-psychiatrist-ipaddr` on branch
`feat/psychiatrist`.

- `mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx`: passed, 34 tests.
- `mise exec -- bun run test tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/thread-store-locking.test.ts tests/server/psychiatrist/api-routes.test.ts tests/server/psychiatrist/context.test.ts tests/server/psychiatrist/events.test.ts tests/server/psychiatrist/prompt.test.ts tests/server/translation/codex-app-server.test.ts`: passed, 7 files / 124 tests.
- `mise exec -- bun run typecheck`: passed.
- `git diff --check`: passed.
- `mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/thread-store-locking.test.ts tests/server/psychiatrist/api-routes.test.ts tests/server/psychiatrist/context.test.ts tests/server/psychiatrist/events.test.ts tests/server/psychiatrist/prompt.test.ts tests/server/translation/codex-app-server.test.ts`: passed, 8 files / 158 tests.
- `mise exec -- bun --bun x playwright test e2e/reader.spec.ts`: passed, 16 tests. Caveat: test server emitted a FORCE_COLOR/NO_COLOR warning.
- `mise exec -- bun run verify`: passed. It ran typecheck, all Vitest suites, and build. Caveat: build emitted the existing Node DEP0155 warning from `defuddle` -> `temml` package exports.

Initial typecheck failure:

- `tests/server/psychiatrist/api-routes.test.ts` injected append hook returned
  `Promise<void>` instead of the expected stream append result.
- Fixed through Revy with a narrow test-only correction, then reran typecheck
  successfully.
