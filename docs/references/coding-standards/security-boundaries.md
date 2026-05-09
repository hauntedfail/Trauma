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
- MUST sanitize rendered markdown or HTML before it reaches the browser.
- MUST NOT use raw HTML injection without a sanitizer and a local explanation.
- MUST preserve highlight markers through deterministic markdown transforms.
- MUST normalize or remove browser capability attributes on allowed embeds.
  Saved markdown must not control iframe `allow` permissions, referrer policy,
  scripts, forms, or same-origin access.
- SHOULD keep markdown transform functions pure and covered by focused tests.

## Security

- MUST NOT hardcode secrets, tokens, credentials, or private local paths.
- MUST keep `.env*` secrets untracked.
- MUST validate URL protocols before importer fetches. `http:` and `https:` are
  the only expected initial protocols.
- MUST prevent XSS in markdown and extracted content rendering.
- MUST avoid leaking stack traces, filesystem paths, or raw dependency errors to
  browser-visible responses.
- MUST keep auth assumptions out of the initial implementation. If auth is
  introduced later, it needs a separate design and threat model.

## Logging And Diagnostics

- MUST NOT leave `console.log` in production code.
- SHOULD use structured server-side diagnostics once a logging helper exists.
- SHOULD keep debug output behind tests, debug scripts, or explicit development
  paths.
- AVOID noisy logging in request paths, import loops, or backup hooks.
