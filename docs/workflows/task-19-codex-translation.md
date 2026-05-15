# Task 19: Codex translation for memories

## Status

- State: Ready for sequential implementation planning
- Base branch: `main`
- Implementation branch: `feat/codex-translation`
- Depends on: Task 18 settings page, translation target language setting, and OpenAI/Codex auth status surface
- Scope: Authenticate Codex with ChatGPT sign-in, translate memory content through Codex, persist translated `CONTENT.md` variants, and expose translation actions from memory reader pages.
- Out of scope: multi-user auth, public hosted OAuth service, direct OpenAI Responses API integration, non-Codex translation providers, collaborative translation editing, translation quality review workflow.

## Current research summary

Official OpenAI/Codex docs establish these constraints:

- Codex supports Sign in with ChatGPT and API-key auth. CLI and IDE support both; ChatGPT sign-in is the default path when no valid session exists.
- `codex login` opens a browser flow for ChatGPT sign-in and returns an access token to the local CLI/IDE.
- Codex caches credentials locally in `~/.codex/auth.json` or the OS credential store.
- `cli_auth_credentials_store` supports `file`, `keyring`, or `auto`.
- `auth.json` contains access tokens and must be treated like a password.
- `codex exec` is the official non-interactive CLI path for scripts; it can read stdin, emit final output, use JSONL, and use output schemas.

No official source found in this pass documents storing ChatGPT sign-in credentials directly inside an arbitrary app SQLite database. Therefore Task 19 must not copy or parse Codex credentials into TRAUMA SQLite in the first implementation.

Source docs:

- [Codex CLI](https://developers.openai.com/codex/cli)
- [Codex authentication](https://developers.openai.com/codex/auth)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540)

## Core decisions

- Use ChatGPT sign-in through Codex.
- Let Codex own credential material through its supported credential store.
- Prefer OS keyring or `auto` for local use.
- Allow file-backed `auth.json` only as an explicit local single-user fallback.
- TRAUMA SQLite stores auth status metadata only, never raw access tokens.
- Translation runs through `codex exec`, not by directly reading `auth.json`.
- TRAUMA writes translated files itself after validating Codex output.
- The source memory content remains `{storePath}/memories/{memoryId}/CONTENT.md`.
- Translated content is stored at `{storePath}/memories/{memoryId}/{langCode}/CONTENT.md`.
- Japanese language code is `ja-JP`.

## Storage contract

Source memory:

```text
{storePath}/memories/{memoryId}/CONTENT.md
```

Translated memory:

```text
{storePath}/memories/{memoryId}/{langCode}/CONTENT.md
```

Example:

```text
{storePath}/memories/018f.../ja-JP/CONTENT.md
```

Translated files must not overwrite the source `CONTENT.md`.

## Subtask execution order

1. [19.1 Codex auth boundary and credential storage](task-19-codex-translation/01-codex-auth-boundary.md)
2. [19.2 Translation storage and database foundation](task-19-codex-translation/02-translation-storage-and-db-foundation.md)
3. [19.3 Codex translation runner](task-19-codex-translation/03-codex-translation-runner.md)
4. [19.4 Settings auth and CLI wiring](task-19-codex-translation/04-settings-auth-and-cli-wiring.md)
5. [19.5 Reader translation UI and API](task-19-codex-translation/05-reader-translation-ui-and-api.md)
6. [19.6 Integration verification and handoff](task-19-codex-translation/06-integration-verification-and-handoff.md)

Each subtask must be implemented in order. Do not start UI wiring before auth/storage/runner contracts are stable.

