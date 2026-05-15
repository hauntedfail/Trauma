# 18.11 Imported media display policy

## Goal

Relax imported media validation so real article media is preserved when safe enough for TRAUMA's reader.

The current `resolveSafeDisplayUrl()` same-host requirement is too strict. Real articles often serve images from first-party or third-party media hosts such as `miro.medium.com` or `pbs.twimg.com`, and may borrow images from a different host. Task 18 should replace same-host-only media validation with a smaller, explicit safety policy.

This subtask also allows controlled iframe preservation. Markdown can contain raw iframe HTML, and TRAUMA's reader already has an iframe sanitizer boundary. Import/capture should align with that reality instead of blanket-dropping every iframe.

## Files likely owned

- `src/server/importer/extractor.ts`
- `src/server/reader/markdown-renderer.ts`
- `extensions/browser/src/capture.ts`
- `src/server/browser-import/import-browser-capture.ts`
- `tests/server/importer/importer.test.ts`
- `tests/server/reader/markdown-renderer.test.ts`
- `tests/server/routes/api-browser-import.test.ts`
- `tests/browser-extension/capture.test.ts`

Use actual existing test paths if they differ.

## Product contract

Imported content should preserve:

- HTTPS images from public hosts, even when the image host differs from the article host.
- `<picture>` structures by resolving their contained `<img src>` first.
- Controlled HTTPS iframes when they are safe enough for reader rendering.

Imported content should still reject:

- `http:` media URLs
- `data:`, `blob:`, `javascript:`, `file:`, and other non-HTTPS media URLs
- URL userinfo
- blocked local/private hostnames
- `srcdoc`
- event-handler attributes such as `onclick`
- arbitrary iframe attributes not allowed by the reader sanitizer

## Image URL policy

Replace same-host-only image validation with:

1. Resolve the media URL relative to the page URL.
2. Require `https:`.
3. Reject username/password userinfo.
4. Reject blocked hostnames using the existing host policy where possible.
5. Strip or ignore all attributes except the minimal Markdown fields needed by the saved content.

Do not require image hostname equality with the page hostname.

This should preserve examples such as:

- Medium article page with image on `miro.medium.com`.
- X/Twitter article page with image on `pbs.twimg.com`.
- Ordinary articles using a CDN or external image host.

## `<picture>` policy

The importer does not need to preserve `<picture>` as HTML.

Required behaviour:

- If a `<picture>` contains an `<img src="...">`, preserve that image as Markdown image when it passes the image URL policy.
- `source srcset` parsing is optional for this subtask.
- If there is no `<img src>`, do not guess from `srcset` unless implementation adds a deterministic parser with tests.

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
sandbox="allow-scripts allow-same-origin allow-presentation"
```

If this breaks common embeds, loosen only with tests and a documented reason.

Reader sanitizer alignment:

- Update `src/server/reader/markdown-renderer.ts` so reader-side iframe validation matches importer/capture policy.
- If reader remains host-allowlist-only, importer must not preserve broader iframes than reader can render.
- Prefer a shared helper for media URL and iframe policy if it prevents drift.

## Browser extension capture policy

Current extension capture removes all `iframe` elements before snapshot.

Change this to:

- remove unsafe iframes
- preserve controlled HTTPS iframes after sanitizing attributes
- continue removing `srcdoc`, event handlers, forms, controls, scripts, styles, and other unsafe/noisy nodes

Images:

- Preserve `<img src>` from HTTPS public hosts even when cross-host.
- Do not reject an image only because it comes from a CDN or media host.

CSS background images:

- Out of scope unless a site-specific extractor needs it.
- Do not parse arbitrary `style="background-image: ..."` generically in this subtask.

## Server URL importer policy

Update `resolveSafeDisplayUrl()` or replace it with media-specific helpers:

- `resolveSafeImageUrl(pageUrl, value)`
- `resolveSafeIframeUrl(pageUrl, value)`

Rules:

- Images and iframes should not use the old same-host-only check.
- Links may keep a stricter policy if needed. Do not automatically relax clickable link validation unless the implementation explicitly decides and tests it.

Important distinction:

- Cross-host images are common article content.
- Cross-host clickable links are navigation affordances and may deserve separate policy.
- Cross-host iframes are executable embeds and need stronger controls than images.

## Tests

Importer tests:

- Medium-style `<picture><source ...><img src="https://miro.medium.com/..."></picture>` becomes Markdown image.
- X/Twitter-style `<img src="https://pbs.twimg.com/...">` becomes Markdown image.
- Cross-host HTTPS image is preserved.
- HTTP image is rejected.
- `data:` image is rejected.
- image with userinfo is rejected.
- blocked/local image host is rejected.

Iframe tests:

- HTTPS iframe with safe attributes is preserved.
- HTTP iframe is rejected.
- `srcdoc` iframe is rejected or stripped so it cannot render inline HTML.
- event-handler attributes are removed.
- unsafe iframe attributes are removed.
- reader sanitizer applies `loading="lazy"` and `referrerpolicy="no-referrer"`.
- reader sanitizer applies or preserves the required sandbox.

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

