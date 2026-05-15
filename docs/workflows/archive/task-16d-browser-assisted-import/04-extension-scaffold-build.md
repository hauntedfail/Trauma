# Task 16d.4: Extension Scaffold And Build

## Goal

Create a minimal Chrome Manifest V3 extension scaffold that can be loaded
unpacked for local development.

## Ownership

Primary files:

- Create: `extensions/browser/manifest.json`
- Create: `extensions/browser/src/types.ts`
- Create: `extensions/browser/src/settings.ts`
- Create: `extensions/browser/src/service-worker.ts`
- Create: `extensions/browser/src/popup.html`
- Create: `extensions/browser/src/popup.ts`
- Create: `extensions/browser/src/capture.ts`
- Create: `extensions/browser/README.md`
- Create: `scripts/build-browser-extension.ts`
- Modify: `package.json`
- Test: `tests/extension/settings.test.ts`

## Manifest Shape

Use Manifest V3:

```json
{
  "manifest_version": 3,
  "name": "TRAUMA Importer",
  "version": "0.1.0",
  "action": {
    "default_popup": "popup.html",
    "default_title": "Import to TRAUMA"
  },
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["http://127.0.0.1/*", "http://localhost/*"]
}
```

Keep permissions narrow:

- Do not request `<all_urls>` host permission.
- Use `activeTab` for the user-selected current tab.
- Use local host permissions only for the TRAUMA endpoint.

## Build Command

Add:

```json
{
  "scripts": {
    "build:extension": "bun run scripts/build-browser-extension.ts"
  }
}
```

Build output:

```text
extensions/browser/dist/
```

The build script should:

- clean `extensions/browser/dist`
- copy `manifest.json`
- copy `popup.html`
- bundle `popup.ts`, `service-worker.ts`, and injected capture code
- fail if output files are missing

## Verification

```bash
mise exec -- bun run test tests/extension/settings.test.ts
mise exec -- bun run build:extension
```

Manual check:

```text
Open chrome://extensions, enable Developer mode, load unpacked
extensions/browser/dist.
```

## Acceptance Criteria

- Extension dist can be loaded unpacked.
- Manifest requests only `activeTab`, `scripting`, `storage`, and local TRAUMA
  host permissions.
- Build is deterministic and does not require npm/yarn/pnpm.
