# Security Boundary Rules

## Boundary Validation

- MUST validate all data crossing a trust boundary before domain use.
- MUST validate route params, query params, form bodies, JSON bodies, config
  files, environment values, filesystem paths, markdown frontmatter, external
  fetch responses, and extractor output.
- MUST fail fast with clear errors when config, persistence, or import input is
  invalid.
- MUST keep validation close to the boundary, then pass typed values inward.
- MUST preserve distinct failure classes. Missing config, unreadable config,
  invalid JSON, invalid shape, malformed frontmatter, and unsupported runtime
  are different failures.
- MUST use serialized field names in errors for serialized artifacts and API
  payloads. For example, frontmatter errors should name `extraction_status`,
  not the internal `extractionStatus` property.
- MUST validate path containment against the actual ownership boundary. A
  database path restriction should target the markdown backup store boundary,
  not a broader project directory unless that is the designed invariant.
- SHOULD use schema-based validation when the shape is non-trivial.

## Markdown, HTML, And Reader Safety

- MUST treat extracted article content as untrusted input.
- MUST let Defuddle own readable-content extraction and markdown serialization.
  TRAUMA must not add ad hoc readability thresholds, site-specific selectors, or
  custom markdown conversion unless a separate design explains why the extractor
  boundary is insufficient.
- MUST sanitize rendered markdown or HTML before it reaches the browser.
- MUST enforce auto-loaded media safety at render time. Images, responsive
  sources, and iframes must not load local/private/IP/userinfo/non-HTTPS URLs
  merely because they appear in extracted markdown.
- MUST NOT use raw HTML injection without a sanitizer and a local explanation.
- MUST preserve allowed reader-rendered flashback marks during sanitization, but
  normal flashback persistence must stay SQLite-backed and must not rewrite
  `CONTENT.md`.
- MUST normalize or remove browser capability attributes on allowed embeds.
  Saved markdown must not control iframe `allow` permissions, referrer policy,
  scripts, forms, or same-origin access.
- SHOULD keep markdown transform functions pure and covered by focused tests.

## Security

- MUST NOT hardcode secrets, tokens, credentials, or private local paths.
- MUST keep `.env*` secrets untracked.
- MUST validate URL protocols before importer fetches. `http:` and `https:` are
  the only expected initial protocols.
- MUST fetch only public HTTP(S) hosts from importer code. Reject localhost,
  `*.localhost`, local/private/link-local/non-global IP targets, URL userinfo, unsafe
  redirects, and DNS answers that resolve outside the public-host policy.
- MUST keep third-party extractor fallback fetches disabled unless they pass
  through the same importer public-host, timeout, redirect, and response-size
  controls.
- MUST bound importer fetches with timeouts, response-size limits, body
  cancellation on fallback paths, and retry over already validated public DNS
  answers before returning link-only fallback. The timeout budget must include
  initial hostname validation and redirect hostname validation, not only the
  final body read.
- MUST include article extraction work in the same import timeout budget.
  Default extractor parsing and conversion must run behind an interruptible
  worker or process boundary instead of blocking the request event loop.
- MUST request identity encoding or explicitly decode compressed bodies when
  using low-level HTTP clients that do not automatically decompress responses.
- MUST decode HTML entities before URL resolution where TRAUMA itself accepts or
  resolves URLs, and MUST strip or reject URL userinfo before importer fetches,
  canonical URLs, favicon URLs, or API response URLs become active.
- MUST keep page-provided canonical URLs and extracted display URLs on the
  normalized source host. A public IP literal is not trusted merely because it
  is public; it must match the source host before becoming an active URL.
- MUST prevent XSS in markdown and extracted content rendering.
- MUST avoid leaking stack traces, filesystem paths, or raw dependency errors to
  browser-visible responses.
- MUST keep auth assumptions out of the initial implementation. If auth is
  introduced later, it needs a separate design and threat model.

## Browser-Assisted Import

- MUST treat browser extension payloads as untrusted external input.
- MUST require explicit local enablement and a bearer token before accepting
  extension imports.
- MUST reject ordinary website origins. A browser extension origin may be
  accepted only with a valid token.
- MUST validate extension payload shape, timestamp freshness, URL protocol,
  URL userinfo, and body size before extraction.
- MUST run final Defuddle extraction and memory persistence on the TRAUMA
  server. The extension may capture a tab snapshot, but it must not bypass
  server-side sanitization or write memory content directly.
- MUST bound browser-extension DOM traversal during capture and sanitization.
  Avoid unbounded deep clones and `querySelectorAll("*")` scans over captured
  page content.
- MUST resolve browser-assisted extractor workers from bundled runtime code or
  inline worker source. Standalone builds must not depend on `src/` files being
  present at runtime.
- MUST NOT persist raw extension HTML.

## Logging And Diagnostics

- MUST NOT leave `console.log` in production code.
- SHOULD use structured server-side diagnostics once a logging helper exists.
- SHOULD keep debug output behind tests, debug scripts, or explicit development
  paths.
- AVOID noisy logging in request paths, import loops, or backup hooks.
