# Task 16d.2: Backend API And Validation

## Goal

Add a hardened local backend endpoint that accepts browser-assisted import
payloads only from a configured privileged client.

## Ownership

Primary files:

- Create: `src/routes/api/browser-import.ts`
- Create: `src/server/browser-import/config.ts`
- Create: `src/server/browser-import/payload.ts`
- Create: `src/server/browser-import/auth.ts`
- Test: `tests/server/browser-import/config.test.ts`
- Test: `tests/server/browser-import/payload.test.ts`
- Test: `tests/server/browser-import/auth.test.ts`
- Test: `tests/server/routes/api-browser-import.test.ts`

## Endpoint

Use:

```text
POST /api/browser-import
```

Required request headers:

```text
content-type: application/json
authorization: Bearer <TRAUMA_BROWSER_IMPORT_TOKEN>
origin: chrome-extension://<extension-id>
```

Response shapes:

```ts
type BrowserImportSuccess = {
  memory: {
    id: string;
    url: string;
    title: string;
  };
};

type BrowserImportError = {
  error: string;
  code:
    | "browser_import_disabled"
    | "unauthorized"
    | "origin_not_allowed"
    | "invalid_content_type"
    | "payload_too_large"
    | "invalid_payload"
    | "extraction_failed";
};
```

## Payload Contract

```ts
interface BrowserImportPayload {
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  html: string;
  capturedAt: string;
  extensionVersion: string;
}
```

Validation rules:

- Reject any key outside the schema.
- `sourceUrl` is required, absolute `http:` or `https:`, no userinfo.
- `canonicalUrl` is optional, absolute `http:` or `https:`, no userinfo.
- `title` max 500 characters.
- `description` max 2,000 characters.
- `html` required, non-empty, max configured bytes.
- `capturedAt` must be an ISO timestamp within 10 minutes of server time.
- `extensionVersion` required, max 64 characters.

## Auth Rules

- Use constant-time comparison for configured token.
- Reject empty configured token when browser import is enabled.
- Reject missing or malformed `Authorization`.
- Do not return whether the token or origin was the closer match.
- Do not log tokens.

## CORS Rules

- Reject ordinary website origins.
- Only return `Access-Control-Allow-Origin` for allowed extension origins.
- Require `authorization` in allowed headers.
- Do not use `*`.
- Preflight `OPTIONS` must apply the same origin allowlist.

## Verification

```bash
mise exec -- bun run test tests/server/browser-import/config.test.ts
mise exec -- bun run test tests/server/browser-import/payload.test.ts
mise exec -- bun run test tests/server/browser-import/auth.test.ts
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
```

## Acceptance Criteria

- Disabled endpoint rejects all imports.
- Missing token rejects.
- Wrong token rejects.
- Wrong origin rejects.
- Simple website-origin POST cannot import.
- Oversized payload rejects before extraction.
- Valid payload reaches the import service boundary.
