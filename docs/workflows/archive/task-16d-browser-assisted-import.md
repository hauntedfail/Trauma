# Task 16d: Browser-Assisted Import Extension Workflow

## Goal

Add a user-triggered browser extension import path for pages that TRAUMA cannot
fetch server-side, while keeping all persistence, validation, sanitization, and
Markdown store writes inside the TRAUMA server.

## Parent Workflow

This is a triage subtask of [Task 16](task-16-red-call-runtime-triage.md).
Task 16 owns runtime/env recovery. Task 16c owns server-side Defuddle import.
This task owns the browser-assisted fallback path.

Current status: this workflow has landed on `main`. Keep this file as the
browser-assisted import execution record; create a new workflow for follow-up
extension or import API behaviour changes.

## Required Context

- [Runtime flows](../../architecture/flows.md)
- [Data and storage architecture](../../architecture/data-and-storage.md)
- [Security boundaries](../../references/coding-standards/security-boundaries.md)
- [Technology stack](../../references/technology-stack.md)
- [OpenAI import failure report](../../research/2026-05-12-openai-harness-engineering-import-failure.md)
- [Task 16c Defuddle importer refactor](task-16c-defuddle-importer-refactor.md)

## Platform Reference

Chrome Extension Manifest V3 documentation confirms the relevant primitives:

- `action.default_popup` for an extension popup UI.
- `activeTab` and `scripting` for user-triggered capture from the current tab.
- `chrome.storage.local` for extension-side local settings.
- `chrome.runtime` messaging between popup, service worker, and content scripts.
- `host_permissions` for explicit extension access to a local TRAUMA server.

## Core Design Answer

Content extraction is not trusted as an extension-only responsibility.

The extension captures a page snapshot from the user-visible tab and sends it to
TRAUMA. The TRAUMA server validates the request, validates the payload, runs the
same server-owned extraction/serialization boundary used by normal imports, and
writes `CONTENT.md`.

This gives the extension enough browser context to handle Cloudflare/challenge
pages that server-side fetch cannot reach, without letting arbitrary extension
payloads bypass server-side security rules.

## Ownership

Primary server files:

- `src/routes/api/browser-import.ts`
- `src/server/browser-import/**`
- `src/server/importer/extractor.ts`
- `src/server/memories/add-memory.ts` only if a small injection seam is needed.
- `tests/server/browser-import/**`
- `tests/server/routes/api-browser-import.test.ts`

Primary extension files:

- `extensions/browser/manifest.json`
- `extensions/browser/src/popup.html`
- `extensions/browser/src/popup.ts`
- `extensions/browser/src/service-worker.ts`
- `extensions/browser/src/capture.ts`
- `extensions/browser/src/settings.ts`
- `extensions/browser/src/types.ts`
- `extensions/browser/README.md`

Primary script/build files:

- `scripts/build-browser-extension.ts`
- `package.json`
- `tests/extension/**`

Conditional docs:

- `docs/references/technology-stack.md`
- `docs/references/configuration.md`
- `docs/references/coding-standards/security-boundaries.md`
- `docs/operations/local-self-hosting.md`
- `docs/quality/verification.md`

Out of scope:

- Publishing to Chrome Web Store.
- Firefox/Safari packaging. Keep the code portable enough for later WebExtension
  work, but implement one Chrome MV3 target first.
- Automatic anti-bot challenge bypass.
- Running a headless browser from the server.
- Importing `file:`, `chrome:`, extension, or internal browser pages.
- Auth for public multi-user deployments.

## Security Model

The browser extension is a privileged local client, not a trusted server module.

Required boundaries:

- Browser-assisted import is disabled unless explicitly enabled by config/env.
- The backend endpoint requires an extension import bearer token.
- The token must come from environment or an untracked local secret file, not
  committed project docs.
- The endpoint accepts only `application/json`.
- The endpoint rejects missing, malformed, or invalid `Authorization` headers.
- The endpoint performs constant-time token comparison.
- The endpoint rejects non-extension web origins by default.
- CORS must not allow arbitrary websites to POST imports.
- Payload size is bounded before parsing.
- `sourceUrl` and `canonicalUrl` must be absolute `http:` or `https:` URLs with
  no userinfo.
- Raw HTML from the extension is untrusted and never persisted as raw HTML.
- The server, not the extension, runs final extraction and Markdown persistence.
- Extension storage may store server URL and token locally, but must never log
  the token or send it to the captured page.

## Parent Exec Plan

Execute these domain plans in order:

1. [Architecture and security boundary](task-16d-browser-assisted-import/01-architecture-security-boundary.md)
2. [Backend API and validation](task-16d-browser-assisted-import/02-backend-api-validation.md)
3. [Server extraction and memory persistence](task-16d-browser-assisted-import/03-server-extraction-memory-persistence.md)
4. [Extension scaffold and build](task-16d-browser-assisted-import/04-extension-scaffold-build.md)
5. [Current-tab capture pipeline](task-16d-browser-assisted-import/05-current-tab-capture-pipeline.md)
6. [Popup user flow and settings](task-16d-browser-assisted-import/06-popup-user-flow-settings.md)
7. [Integration verification and handoff](task-16d-browser-assisted-import/07-integration-verification-handoff.md)

## Runtime Flow

```text
User opens page in browser
  -> user clicks TRAUMA extension
  -> popup shows current tab and import button
  -> user clicks Import current tab
  -> extension captures DOM snapshot from active tab
  -> extension sends JSON payload to local TRAUMA endpoint with bearer token
  -> backend validates token, origin, content type, size, URL, and payload shape
  -> backend runs Defuddle extraction on supplied snapshot HTML
  -> backend creates memory through existing addMemory/store/DB/backup path
  -> backend returns memory id
  -> popup opens /memories/{id} or shows error
```

## Acceptance Criteria

- A Chrome MV3 extension can be built locally.
- The extension popup has a one-click import button for the current active tab.
- The backend endpoint is disabled by default or requires explicit local secret
  configuration before accepting imports.
- The backend rejects requests without a valid bearer token.
- The backend rejects ordinary website-origin requests.
- The backend validates payload shape, URL scheme, body size, and text length.
- The extension does not perform final trusted persistence or bypass server
  validation.
- Browser-captured content is converted into `CONTENT.md` through the server
  extraction/store path.
- A page blocked from server-side fetch can be imported when the user can view it
  in their browser.
- Tests cover token rejection, payload rejection, successful memory creation,
  capture sanitization, and popup/service worker message flow where practical.

## Verification Commands

Run from the implementation branch:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/server/browser-import
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run test tests/extension
mise exec -- bun run build:extension
mise exec -- bun run verify
```

Manual verification:

```text
1. Start TRAUMA locally with browser-assisted import enabled and a local token.
2. Load the unpacked extension from extensions/browser/dist.
3. Configure TRAUMA URL and token in the popup.
4. Open https://openai.com/ja-JP/index/harness-engineering/ in the browser.
5. Click the extension action.
6. Click Import current tab.
7. Confirm TRAUMA opens /memories/{id} with extracted body content.
```

## Branching And PR Flow

Historical branch flow for this merged task:

```bash
git switch triage
git pull --ff-only origin triage
git switch -c triage-browser-assisted-import
```

The PR targeted the active triage branch at the time. New follow-up work should
branch from the current target branch and use a fresh branch name.

## PR Handoff

The PR description must include:

- Extension architecture and permission list.
- Backend endpoint path and security controls.
- Token configuration mechanism.
- Payload schema summary.
- Where extraction is performed and why.
- Manual import evidence for a server-fetch-blocked URL.
- Exact verification commands and outcomes.
