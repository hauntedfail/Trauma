# Task 16d.7: Integration Verification And Handoff

## Goal

Verify browser-assisted import across backend, extension build, and manual local
workflow, then document the handoff clearly.

## Ownership

Primary files:

- `docs/operations/local-self-hosting.md`
- `docs/quality/verification.md`
- `extensions/browser/README.md`
- `docs/workflows/task-16d-browser-assisted-import.md`

Conditional files:

- `README.md` if local extension setup becomes part of the top-level quickstart.
- `docs/references/technology-stack.md` if extension build dependencies are
  added.

## Automated Verification

Run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/server/browser-import
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run test tests/extension
mise exec -- bun run build:extension
mise exec -- bun run verify
```

If runtime/E2E is stable on the target branch, also run:

```bash
mise exec -- bun run test:e2e
```

## Manual Verification

Use a local secret:

```bash
TRAUMA_BROWSER_IMPORT_ENABLED=true \
TRAUMA_BROWSER_IMPORT_TOKEN=<local random token> \
mise exec -- bun run dev
```

Then:

```text
1. Load extensions/browser/dist in Chrome extension developer mode.
2. Configure server URL and token in the popup.
3. Open a normal article page and import it.
4. Open https://openai.com/ja-JP/index/harness-engineering/ and import it.
5. Confirm the successful imports open /memories/{id}.
6. Confirm CONTENT.md exists under the configured store path.
7. Confirm raw HTML is not stored.
```

## Negative Manual Checks

```text
1. Remove the token and confirm import is rejected.
2. Set an incorrect token and confirm import is rejected.
3. Try importing chrome://extensions and confirm it is rejected before network.
4. Attempt a browser-origin POST without Authorization and confirm it fails.
```

## PR Handoff Checklist

- State endpoint path.
- State extension permissions.
- State token configuration mechanism.
- State payload schema and size limit.
- State where extraction and persistence occur.
- Include the target OpenAI URL manual result.
- Include automated command outcomes.
- Include any browser/OS version used for manual extension verification.

## Acceptance Criteria

- Backend and extension verification pass.
- Manual local import works for a normal article.
- Manual local import works for a page that server-side fetch cannot access but
  the user's browser can view.
- Security negative checks are recorded.
