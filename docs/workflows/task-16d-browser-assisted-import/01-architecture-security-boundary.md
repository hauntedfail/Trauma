# Task 16d.1: Architecture And Security Boundary

## Goal

Lock the browser-assisted import contract before implementation starts.

## Ownership

Primary files:

- `docs/workflows/task-16d-browser-assisted-import.md`
- `docs/references/coding-standards/security-boundaries.md`
- `docs/references/configuration.md`
- `docs/architecture/flows.md`

## Decisions To Preserve

- Extension captures page snapshot; server performs final extraction and
  persistence.
- Browser-assisted import is explicit user action only.
- Backend endpoint requires bearer token.
- Endpoint is not available as an unauthenticated local CSRF target.
- Raw extension HTML is never persisted.

## Implementation Notes

Document the security invariant in durable docs:

```text
Browser-assisted import payloads are untrusted external input. The extension may
capture user-visible DOM, but the server must validate the request, validate the
payload, run extraction/sanitization, and write CONTENT.md through the existing
store path.
```

Add configuration reference for:

```text
TRAUMA_BROWSER_IMPORT_ENABLED=true
TRAUMA_BROWSER_IMPORT_TOKEN=<local random secret>
TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS=chrome-extension://<extension-id>
TRAUMA_BROWSER_IMPORT_MAX_BYTES=5000000
```

Rules:

- `TRAUMA_BROWSER_IMPORT_ENABLED` defaults to false.
- Token is required when enabled.
- `TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS` is optional for development but
  should be configured for a packaged extension.
- `TRAUMA_BROWSER_IMPORT_MAX_BYTES` defaults to 5 MB.

## Verification

```bash
rg -n "Browser-assisted import|TRAUMA_BROWSER_IMPORT" docs
```

## Acceptance Criteria

- Docs state where extraction occurs.
- Docs state the extension is untrusted input.
- Docs state the token and payload-size boundaries.
- No API or extension code is implemented in this first domain step.
