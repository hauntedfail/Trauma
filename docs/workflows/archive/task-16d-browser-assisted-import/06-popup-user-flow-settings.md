# Task 16d.6: Popup User Flow And Settings

## Goal

Implement the extension popup as the user-visible dialog for one-click current
tab import.

## Ownership

Primary files:

- `extensions/browser/src/popup.html`
- `extensions/browser/src/popup.ts`
- `extensions/browser/src/settings.ts`
- `extensions/browser/src/service-worker.ts`
- `tests/extension/settings.test.ts`
- `tests/extension/popup-state.test.ts`

## Popup UI

The popup should show:

- TRAUMA server URL.
- Token status, not the raw token after save.
- Current tab URL preview.
- Primary button: `Import current tab`.
- Secondary button/link: `Open TRAUMA`.
- Compact status area for success or failure.

The first implementation may use plain HTML/CSS. Do not add a frontend
framework inside the extension.

## Settings

Store in `chrome.storage.local`:

```ts
interface ExtensionSettings {
  traumaUrl: string;
  token: string;
}
```

Validation:

- `traumaUrl` must be `http://127.0.0.1:<port>` or `http://localhost:<port>`.
- `token` must be non-empty.
- Never write token into the DOM except in a password input during editing.
- Never send token to the captured page.

## Import Flow

1. Popup loads settings.
2. Popup queries active tab.
3. User clicks `Import current tab`.
4. Popup or service worker injects capture script into active tab.
5. Extension sends payload to `${traumaUrl}/api/browser-import` with:

   ```text
   Authorization: Bearer <token>
   Content-Type: application/json
   ```

6. On success, popup opens `${traumaUrl}/memories/${memory.id}`.
7. On failure, popup shows a concise error and keeps the popup open.

## Verification

```bash
mise exec -- bun run test tests/extension/settings.test.ts
mise exec -- bun run test tests/extension/popup-state.test.ts
mise exec -- bun run build:extension
```

## Acceptance Criteria

- User can configure local TRAUMA URL and token.
- User can import current tab with one click after configuration.
- Success opens the created memory route.
- Failure messages do not expose token or server stack traces.
