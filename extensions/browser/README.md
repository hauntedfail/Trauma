# TRAUMA Browser Extension

This Chrome Manifest V3 extension imports the current browser tab into a local
TRAUMA instance.

## Build

```bash
bun run build:extension
```

The unpacked extension is written to:

```text
extensions/browser/dist
```

## Local Setup

1. Start TRAUMA with browser import enabled:

   ```bash
   TRAUMA_BROWSER_IMPORT_ENABLED=true \
   TRAUMA_BROWSER_IMPORT_TOKEN=<local random token> \
   bun run dev
   ```

2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked `extensions/browser/dist`.
5. Open the TRAUMA extension popup.
6. Configure the local instance address and token in Settings.

Only local `localhost` and `127.0.0.1` instance addresses are accepted by the
extension UI.
