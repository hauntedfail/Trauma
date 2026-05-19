# 18.11 Imported media display policy

## Goal

Keep imported media safe without taking ownership of readable-content
extraction. Defuddle owns article cleanup and markdown serialization; TRAUMA
owns fetch/payload trust boundaries, persistence, and reader sanitization.

The importer must not depend on a custom HTML-to-Markdown converter or a
TRAUMA-defined readability threshold. Media safety is enforced where markdown is
rendered, because persisted markdown can come from URL import, browser import,
fixtures, or future migration paths.

## Files likely owned

- `src/server/importer/extractor.ts`
- `src/server/reader/markdown-renderer.ts`
- `src/server/browser-import/import-browser-capture.ts`
- `tests/server/importer/importer.test.ts`
- `tests/server/reader/markdown-renderer.test.ts`
- `tests/server/browser-import/import-browser-capture.test.ts`

Use actual existing test paths if they differ.

## Product contract

Imported content should:

- Preserve Defuddle markdown as the canonical extracted content artifact.
- Accept short non-empty Defuddle markdown. Empty markdown is the only
  readability fallback condition owned by TRAUMA.
- Render HTTPS images from public named hosts, even when the image host differs
  from the article host.
- Render controlled HTTPS iframes when they pass the reader sanitizer.

Reader rendering should reject:

- `http:` media URLs
- `data:`, `blob:`, `javascript:`, `file:`, and other non-HTTPS media URLs
- URL userinfo
- blocked local/private hostnames
- `srcdoc`
- event-handler attributes such as `onclick`
- arbitrary iframe attributes not allowed by the reader sanitizer

## Image URL Policy

Do not rewrite imported markdown URLs in the importer. When rendering markdown:

1. Require absolute `https:` image URLs.
2. Reject username/password userinfo.
3. Reject blocked local/private hostnames and IP literals.
4. Sanitize `srcset` candidate-by-candidate.
5. Strip unsafe image tags instead of making the browser fetch them.

Do not require image hostname equality with the page hostname.

This should preserve examples such as:

- Medium article page with image on `miro.medium.com`.
- X/Twitter article page with image on `pbs.twimg.com`.
- Ordinary articles using a CDN or external image host.

## `<picture>` Policy

Defuddle may produce markdown image syntax or raw `<picture>` HTML. TRAUMA
does not reconstruct `<picture>` markup during import. The reader sanitizer is
responsible for allowing only safe `source srcset` candidates and safe fallback
`img src` values.

Rationale:

- The `<img>` fallback is the browser-compatible canonical fallback.
- `srcset` selection requires viewport/DPR/media evaluation, which is out of scope for a storage importer.

## Iframe policy

Allowing iframes is acceptable only through a controlled policy. `https` alone is not enough because an iframe can execute a full third-party web app inside the reader.

Required iframe preservation rules:

1. Resolve `src` relative to the page URL.
2. Require `https:`.
3. Reject username/password userinfo.
4. Reject blocked local/private hostnames.
5. Remove `srcdoc`.
6. Remove all `on*` event-handler attributes.
7. Preserve only a minimal attribute set:
   - `src`
   - `title`
   - `loading`
   - `allowfullscreen`
   - optional `width`
   - optional `height`
8. Force or normalize:
   - `loading="lazy"`
   - `referrerpolicy="no-referrer"`
   - `sandbox` with a deliberately limited value

Recommended initial sandbox:

```html
sandbox="allow-scripts allow-presentation"
```

Do not include `allow-same-origin` by default. Combining `allow-scripts` and
`allow-same-origin` materially weakens the sandbox boundary for third-party
content. If a specific allowlisted provider demonstrably requires
`allow-same-origin`, add it only for that provider with tests and a documented
reason.

Initial iframe permission matrix:

| Embed type | Initial sandbox | Rationale |
| --- | --- | --- |
| YouTube/Vimeo-style video embed | `allow-scripts allow-presentation` | Supports script-driven player boot while avoiding same-origin storage access by default. |
| Generic article embed | `allow-scripts allow-presentation` | Treat as untrusted executable content; do not grant same-origin unless provider-specific tests prove it is required. |
| X/Twitter timeline/post embed | Not guaranteed in this subtask | If it fails without `allow-same-origin`, keep it blocked or add a provider-specific policy with tests rather than broadening the default. |

Reader sanitizer alignment:

- Update `src/server/reader/markdown-renderer.ts` so reader-side iframe validation matches importer/capture policy.
- If reader remains host-allowlist-only, importer must not preserve broader iframes than reader can render.
- Prefer a shared helper for media URL and iframe policy if it prevents drift.

## Browser Extension Capture Policy

The extension captures a bounded visible DOM snapshot only. It must not decide
whether the page is long enough to become a memory, generate final markdown, or
write persisted content. The server reruns Defuddle against the captured HTML.

CSS background images:

- Out of scope unless a site-specific extractor needs it.
- Do not parse arbitrary `style="background-image: ..."` generically in this subtask.

## Server URL Importer Policy

Rules:

- URL fetch and redirect validation remain importer-owned.
- Defuddle async fallback fetches remain disabled unless they are routed through
  the same public-host/timeout/size controls.
- Non-empty Defuddle markdown is importable even when it is short.
- Empty Defuddle markdown becomes link-only fallback for URL import and a
  browser-import error for browser-assisted import.

## Tests

Importer tests:

- Defuddle markdown output is persisted without a TRAUMA readability threshold.
- Short non-empty Defuddle markdown succeeds.
- Empty Defuddle markdown falls back or errors at the appropriate import
  boundary.

Reader sanitizer tests:

- HTTPS iframe with safe attributes is preserved.
- HTTP iframe is rejected.
- `srcdoc` iframe is rejected or stripped so it cannot render inline HTML.
- event-handler attributes are removed.
- Unsafe image and `srcset` URLs are stripped before the browser can load them.
- unsafe iframe attributes are removed.
- reader sanitizer applies `loading="lazy"` and `referrerpolicy="no-referrer"`.
- reader sanitizer applies or preserves the required sandbox.
- default iframe sandbox omits `allow-same-origin`.
- any provider-specific use of `allow-same-origin` has explicit tests and a documented reason.

Extension capture tests:

- safe HTTPS iframe survives sanitized snapshot with limited attrs.
- unsafe iframe is removed.
- cross-host HTTPS image survives snapshot.
- event handlers and `srcdoc` are removed.

## Verification

```sh
mise exec -- bun run test tests/server/importer/importer.test.ts
mise exec -- bun run test tests/server/reader/markdown-renderer.test.ts
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run test tests/browser-extension/capture.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Same-host-only media display validation is removed for images.
- HTTPS cross-host images can be preserved in imported Markdown.
- `<picture>` with `<img src>` preserves the image.
- Controlled HTTPS iframes can be preserved.
- Unsafe iframe forms are still rejected or sanitized.
- Reader sanitizer and importer/capture media policy do not drift.
- Link validation is not accidentally relaxed unless explicitly tested.
