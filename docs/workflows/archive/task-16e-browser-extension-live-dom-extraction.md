# Task 16e: Browser Extension Live DOM Extraction Workflow

## Goal

Redefine browser-assisted import so the extension injects a bundled content
script into the user-visible current tab, extracts article content from that
tab's live DOM, and sends the extracted snapshot to TRAUMA without server-side
fetching the source URL.

## Parent Workflow

This is a corrective follow-up to
[Task 16d](task-16d-browser-assisted-import.md). Task 16d introduced the local
extension and backend import route. This task fixes the extension capture model:
the server must not compensate for browser import by fetching the current tab
URL, and the injected code must run as a bundled content script with its helper
code available in the page execution context.

Current status: this workflow has landed on `main`. Keep this file as the live
DOM extraction execution record; create a new workflow for follow-up extension
capture changes.

## Required Context

- [Task 16d Browser-assisted import extension](task-16d-browser-assisted-import.md)
- [Current-tab capture pipeline](task-16d-browser-assisted-import/05-current-tab-capture-pipeline.md)
- [Security boundaries](../../references/coding-standards/security-boundaries.md)
- [Configuration reference](../../references/configuration.md)
- [Technology stack](../../references/technology-stack.md)

## Corrected Design Answer

The browser extension owns browser-only access to the live tab DOM. The server
owns validation, persistence, markdown store writes, and backup status.

The extension import path is not a server-side URL fetch. It must use:

```json
"permissions": ["activeTab", "scripting", "storage"]
```

The local TRAUMA server host permissions remain only for posting the extracted
payload to `localhost` or `127.0.0.1`.

Runtime flow:

```text
user clicks extension action
  -> background service worker receives current tab
  -> activeTab + scripting permission injects inject.bundle.js into current tab
  -> content script accesses the current page document
  -> content script clones document with document.cloneNode(true)
  -> content script runs site-specific selector extraction against the live DOM
  -> content script returns a bounded extracted payload to the service worker
  -> service worker POSTs extracted payload to local TRAUMA with bearer token
  -> server validates token, origin, content type, size, URL, timestamp, and payload
  -> server converts the extracted content into the normal memory creation path
  -> server writes CONTENT.md, SQLite metadata, and backup status through addMemory()
```

## Ownership

Primary extension files:

- `extensions/browser/manifest.json`
- `extensions/browser/src/service-worker.ts`
- `extensions/browser/src/capture.ts`
- `extensions/browser/src/types.ts`
- `extensions/browser/src/popup.ts`
- `extensions/browser/src/popup.html`
- `extensions/browser/README.md`

Primary build files:

- `scripts/build-browser-extension.ts`
- `package.json` only if script names change.

Primary server files:

- `src/routes/api/browser-import.ts`
- `src/server/browser-import/payload.ts`
- `src/server/browser-import/import-browser-capture.ts`
- `src/server/browser-import/index.ts`
- `src/server/importer/extractor.ts` only if reusable HTML-to-markdown helpers
  need to be exported.
- `src/server/memories/add-memory.ts` only if the existing injected importer
  seam needs a small extension.

Primary tests:

- `tests/extension/capture.test.ts`
- `tests/extension/settings.test.ts`
- `tests/server/browser-import/payload.test.ts`
- `tests/server/browser-import/import-browser-capture.test.ts`
- `tests/server/routes/api-browser-import.test.ts`

Conditional docs:

- `docs/references/configuration.md`
- `docs/references/coding-standards/security-boundaries.md`
- `docs/references/technology-stack.md`

Out of scope:

- Chrome Web Store publishing.
- Public remote TRAUMA instances.
- Server-side browsing, Playwright fetch fallback, or headless browser fallback.
- Automatic bypass of anti-bot challenges the user cannot already view.
- Importing `file:`, `chrome:`, extension, or internal browser pages.

## Parent Exec Plan

Execute these steps in order.

1. **Lock the corrected capture contract**
   - Replace the browser import payload contract with extracted tab content,
     not a raw whole-document server extraction request.
   - Keep `sourceUrl`, optional `canonicalUrl`, optional `title`, optional
     `description`, `capturedAt`, and `extensionVersion`.
   - Add extracted fields such as `articleHtml`, `articleText`, `selector`,
     and `extractionStrategy`.
   - Keep payload size and timestamp limits.
   - Explicitly reject payloads that contain unknown fields.

2. **Build `inject.bundle.js`**
   - Add `extensions/browser/src/inject.ts` as the injected content-script
     entrypoint.
   - Update `scripts/build-browser-extension.ts` so `inject.ts` is built into
     `extensions/browser/dist/inject.bundle.js`.
   - Keep `popup.js` and `service-worker.js` as separate bundle outputs.
   - Ensure the dist directory contains `manifest.json`, `popup.html`,
     `popup.js`, `service-worker.js`, and `inject.bundle.js`.

3. **Change service worker injection from `func` to `files`**
   - Replace `chrome.scripting.executeScript({ func: createCapturedTabSnapshot })`
     with `chrome.scripting.executeScript({ files: ["inject.bundle.js"] })`.
   - Use `activeTab` and `scripting`; do not add broad host permissions for
     arbitrary websites.
   - Return Chrome injection errors to the popup with the original error
     message.
   - Ensure the injected bundle returns exactly one typed capture result for the
     current tab.

4. **Implement live DOM extraction inside the injected bundle**
   - In `inject.ts`, read from the current tab `document`.
   - Reject non-HTTP(S) pages before extraction.
   - Clone with `document.documentElement.cloneNode(true)`.
   - Remove active or user-input surfaces from the clone before extraction:
     `script`, `style`, `noscript`, `template`, `iframe`, `object`, `embed`,
     `canvas`, `svg`, `form`, `input`, `textarea`, `select`, and `button`.
   - Remove event-handler attributes and `srcdoc`.
   - Run site-specific selectors before generic extraction.
   - Run site-specific selectors against the live `document`, not only against
     the cloned document. `document.cloneNode(true)` and
     `document.documentElement.cloneNode(true)` do not clone shadow roots, so
     the selector path must be able to inspect live DOM and open shadow roots
     before falling back to cloned generic extraction.
   - Add a focused live-DOM selector helper that starts with ordinary
     `document.querySelectorAll(selector)` and then traverses open shadow roots
     where available. Do not treat the example helper in the spec as literal
     code; implement the helper in the local style with cycle protection and a
     bounded traversal.
   - Initial selector table must include a stable OpenAI/harness case if that is
     still the target manual reproduction page.
   - Fall back to semantic selectors in order: `article`, `main`,
     `[role="main"]`, then `body`.
   - Return bounded `articleHtml` and readable `articleText`; do not return the
     entire page clone when a narrower article candidate exists.

5. **Update server-side browser import ingestion**
   - Treat extension payload as untrusted extracted content.
   - Do not server-side fetch `sourceUrl` or `canonicalUrl`.
   - Convert `articleHtml` to markdown server-side, or reuse a narrowly exported
     safe HTML-to-markdown helper from the importer module.
   - Preserve server ownership of `CONTENT.md`, SQLite metadata, and backup
     queue behavior through `addMemory()`.
   - Reject too-short extracted content before memory creation.
   - Return `/memories/{id}` on success.

6. **Update tests**
   - Add an extension test proving `inject.bundle.js` is emitted by the build.
   - Add pure extraction tests for site-specific selector extraction and generic
     fallback extraction.
   - Add a test proving site-specific selector extraction can read content from
     an open shadow root through the live document path.
   - Add a test proving generic clone fallback still works when no site-specific
     selector matches.
   - Add a test proving `service-worker.ts` uses file injection rather than
     function injection.
   - Update payload tests for the new extracted-content schema.
   - Update browser import persistence tests so success uses extension-extracted
     `articleHtml` and does not depend on server-side URL fetch.
   - Keep rejection tests for token, origin, content type, size, timestamp, and
     non-HTTP(S) pages.

7. **Update docs and handoff**
   - Update `extensions/browser/README.md` to describe live DOM extraction.
   - Update security docs only if the revised payload contract changes a durable
     invariant.
   - Add manual verification evidence for a page that succeeds via extension
     capture even when normal URL import is not the target path.

## Acceptance Criteria

- `manifest.json` keeps `"permissions": ["activeTab", "scripting", "storage"]`.
- The extension imports by injecting `inject.bundle.js` into the current tab.
- The injected bundle accesses the current tab document and clones it with
  `document.cloneNode(true)` or `document.documentElement.cloneNode(true)`.
- Site-specific selector extraction runs inside the injected content script and
  queries the live document, including open shadow roots where available.
- Generic fallback extraction may use the sanitized cloned document.
- The service worker no longer passes module functions directly through
  `executeScript({ func })`.
- The browser import server path does not fetch the current tab URL to recover
  content.
- Extension payloads remain authenticated, size-bounded, timestamp-bounded, and
  rejected unless sent from an allowed extension origin.
- Raw whole-page HTML is not persisted as raw HTML.
- Memory creation still goes through the existing server-owned `addMemory()`
  persistence path.

## Verification Commands

Run from the implementation branch:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/extension
mise exec -- bun run test tests/server/browser-import
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run build:extension
mise exec -- bun run verify
```

Manual verification:

```text
1. Build the extension with `mise exec -- bun run build:extension`.
2. Start TRAUMA with browser import enabled and a local bearer token.
3. Load extensions/browser/dist in Chrome developer mode.
4. Configure the local TRAUMA URL and token in extension settings.
5. Open the target page in a normal browser tab.
6. Click the TRAUMA extension action and start import.
7. Confirm the popup reports success and opens /memories/{id}.
8. Confirm the saved memory contains extracted article body content, not a
   server-side URL-fetch fallback and not raw whole-page HTML.
9. Try `chrome://extensions` and confirm it is rejected before network.
10. Try an invalid token and confirm the server returns token rejection.
```

## Branching And PR Flow

Historical branch flow for this merged task:

```bash
git switch triage
git pull --ff-only origin triage
git switch -c triage-browser-live-dom-extraction
```

The PR targeted the active triage branch at the time. New follow-up work should
branch from the current target branch and use a fresh branch name.

## PR Handoff

The PR description must include:

- The corrected runtime flow from action click to content script extraction.
- Confirmation that `inject.bundle.js` is injected by file, not function.
- The exact extension permission list.
- The browser import payload schema.
- Where site-specific selectors live and how generic fallback works.
- Confirmation that the server does not fetch the current tab URL in this path.
- Exact verification commands and outcomes.
- Manual browser, OS, and target-page evidence.
