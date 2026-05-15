# 19.1 Codex auth boundary and credential storage

## Goal

Define and implement the authentication boundary for using Codex from TRAUMA.

The key decision: TRAUMA does not own raw ChatGPT/Codex credentials. Codex owns credentials through its supported credential store. TRAUMA stores only status and configuration metadata.

## Research basis

Official Codex docs state:

- Codex supports Sign in with ChatGPT and API key auth.
- CLI Sign in with ChatGPT opens a browser window and returns an access token to the local CLI.
- Codex caches login details locally in `~/.codex/auth.json` or in the OS credential store.
- `cli_auth_credentials_store` can be `file`, `keyring`, or `auto`.
- File-based `auth.json` contains access tokens and must be treated like a password.
- Device-code auth is available for headless/remote cases.

No official doc found for putting ChatGPT sign-in credentials directly into arbitrary app SQLite.

## Files likely owned

- `src/server/settings/openai-auth.ts`
- `src/server/settings/codex-auth.ts`
- `src/server/db/schema.ts`
- `drizzle/<new-migration>.sql`
- `src/server/db/repositories.ts`
- `tests/server/settings/codex-auth.test.ts`
- `tests/server/db/schema.test.ts`

## Credential storage decision

Supported implementation:

- Use Codex credential store.
- Prefer `cli_auth_credentials_store = "auto"` or `"keyring"` for local use.
- Allow `"file"` only if explicitly configured by the user for local single-user operation.
- Use `CODEX_HOME` only to isolate TRAUMA's Codex configuration if implementation needs an app-specific store.

Not allowed in this task:

- Storing raw access tokens in SQLite.
- Parsing `auth.json` beyond existence/status checks that do not expose content.
- Copying `auth.json` into backups.
- Returning credential material to the frontend.
- Logging tokens or full auth file paths with sensitive details.

## SQLite metadata contract

Add a non-secret auth metadata table if needed:

```ts
codexAuthState: {
  id: "default";
  status: "disabled" | "enabled" | "unknown" | "error";
  credentialStore: "auto" | "keyring" | "file";
  codexHome: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- This table does not contain tokens.
- `status` is derived by running a safe Codex auth-status check or dry command, not from a client flag.
- `enabled` means Codex can run a minimal authenticated operation.
- `unknown` means TRAUMA cannot prove status without running Codex.

## Auth status strategy

Preferred status check:

- Run a minimal Codex CLI command that proves credentials are usable without translating content.
- If no safe command exists, run a short `codex exec --ephemeral` status prompt with no sensitive input and parse success/failure.

Fallback status check:

- Detect whether a Codex credential store is configured and auth cache likely exists.
- Mark as `unknown` rather than `enabled` if usability was not verified.

## Tests

Cover:

- metadata table stores no token fields
- status can be `disabled`, `enabled`, `unknown`, or `error`
- enabled status requires server-side verification
- auth status API never returns tokens
- file-backed credential path is treated as sensitive

## Verification

```sh
mise exec -- bun run test tests/server/settings/codex-auth.test.ts
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- TRAUMA has a documented Codex auth boundary.
- SQLite stores only non-secret auth metadata.
- Implementation does not depend on unsupported SQLite storage for ChatGPT credentials.

