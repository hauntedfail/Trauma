# 19.6 Integration verification and handoff

## Goal

Verify Codex auth, settings integration, translation persistence, and reader translation UX after subtasks 19.1 through 19.5 are complete.

## Manual smoke

1. Open `/settings`.
2. Select translation target `ja-JP`.
3. Confirm the setting persists after refresh.
4. Confirm Codex auth status is disabled before login.
5. Run `bun run trauma:codex-login` or start login from the settings button.
6. Complete ChatGPT sign-in through Codex.
7. Confirm settings shows Codex auth enabled.
8. Open a memory reader page.
9. Click translate.
10. Confirm a translated file exists at `{memoryId}/ja-JP/CONTENT.md`.
11. Confirm source `{memoryId}/CONTENT.md` is unchanged.
12. Open `/memories/:id?lang=ja-JP`.
13. Confirm translated Markdown renders.
14. Trigger translate again and confirm current translation is reused when source hash matches.
15. Modify source fixture in a test and confirm stale translation is detected.

## Commands

```sh
mise exec -- bun run test tests/server/settings/codex-auth.test.ts
mise exec -- bun run test tests/server/store/translated-memory-content.test.ts
mise exec -- bun run test tests/server/translation/codex-runner.test.ts
mise exec -- bun run test tests/server/translation/translate-memory.test.ts
mise exec -- bun run test tests/server/routes/api-memory-translation.test.ts
mise exec -- bun run test tests/server/routes/api-settings.test.ts
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/components/settings-page.test.tsx
mise exec -- bun run test tests/components/memory-reader-translation.test.tsx
mise exec -- bun run test tests/scripts/trauma-codex-auth.test.ts
mise exec -- bun run typecheck
mise exec -- bun run verify
```

## PR handoff checklist

Include:

- auth storage decision
- why SQLite does not store raw credentials
- settings language code contract
- translation storage layout
- Codex command invocation strategy
- source hash/staleness strategy
- exact verification commands and outcomes

## Acceptance criteria

- Codex ChatGPT sign-in path is documented and implemented through supported Codex storage.
- CLI auth commands exist.
- Settings language and auth fields drive translation.
- Reader translation button works.
- Translated `CONTENT.md` is stored under `{memoryId}/{langCode}/CONTENT.md`.
- Source `CONTENT.md` remains unchanged.

