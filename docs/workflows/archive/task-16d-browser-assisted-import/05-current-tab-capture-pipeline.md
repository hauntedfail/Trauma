# Task 16d.5: Current-Tab Capture Pipeline

## Goal

Capture the current user-visible tab into a bounded, serializable page snapshot
without trusting that snapshot as final content.

## Ownership

Primary files:

- `extensions/browser/src/capture.ts`
- `extensions/browser/src/types.ts`
- `tests/extension/capture.test.ts`

## Capture Contract

```ts
interface CapturedTabSnapshot {
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  html: string;
  capturedAt: string;
  extensionVersion: string;
}
```

## Capture Rules

The injected capture function runs in the active tab after user action.

It must:

- reject non-HTTP(S) pages.
- clone `document.documentElement`.
- remove `script`, `style`, `noscript`, `template`, `iframe`, `object`,
  `embed`, `canvas`, `svg`, `form`, `input`, `textarea`, `select`, and `button`
  before serialization.
- remove attributes starting with `on`.
- remove `srcdoc`.
- preserve `href`, `src`, `alt`, heading text, paragraphs, lists, tables, code,
  blockquotes, article/main content, and image references.
- read canonical URL from `link[rel~="canonical"]`.
- read description from `meta[name="description"]` or
  `meta[property="og:description"]`.
- serialize the cleaned clone to HTML.
- enforce an extension-side size ceiling before sending to the service worker.

The server still validates and sanitizes again. Extension-side cleaning is a
blast-radius reduction, not a trust boundary.

## Tests

Use pure tests for the capture sanitizer:

- removes scripts and event handlers.
- removes forms and controls.
- keeps article text, links, images, tables, and code.
- rejects `chrome://`, `file://`, and extension pages.
- enforces max size.

## Verification

```bash
mise exec -- bun run test tests/extension/capture.test.ts
mise exec -- bun run build:extension
```

## Acceptance Criteria

- Captured snapshot is JSON serializable.
- Captured snapshot excludes active script/form surfaces.
- Current tab URL is preserved.
- Server remains responsible for final validation and extraction.
