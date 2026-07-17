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
  database path restriction should target the configured store boundary, not a
  broader project directory unless that is the designed invariant.
- SHOULD use schema-based validation when the shape is non-trivial.

## Markdown, HTML, And Reader Safety

- MUST treat extracted article content as untrusted input.
- MUST let Defuddle own readable-content extraction and markdown serialization.
  TRAUMA must not add ad hoc readability thresholds, site-specific selectors, or
  custom markdown conversion unless a separate design explains why the extractor
  boundary is insufficient.
- MUST sanitize rendered markdown or HTML before it reaches the browser.
- MUST bound syntax-highlighting work for untrusted code fences. Oversized or
  unknown-language blocks render as escaped plain code instead of entering a
  high-cost grammar or automatic language scan.
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
- MUST disable repository and global Git hooks for every built-in git command,
  including readiness checks, normal backup, retry, startup recovery, and
  failsafe repair. Apply a command-scoped null `core.hooksPath` through the
  shared Git execution boundary; trusting `projectPath` never grants ambient
  hook execution.
- MUST NOT add a user-configurable shell hook surface to built-in backup.
- MUST validate URL protocols before importer fetches. `http:` and `https:` are
  the only accepted importer protocols.
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
- MUST reject excess URL and browser-assisted imports through fixed,
  process-wide, non-queuing admission before fetch, extraction, or browser body
  buffering. Return a stable `429` plus `Retry-After` and release admission on
  every terminal path.
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
- MUST NOT mistake Codex app-server login for TRAUMA access control. User
  accounts, browser sessions, public signup, or multi-user ownership require a
  separate design and threat model.

## Codex App-Server Boundaries

- MUST treat memory content, translated content, source pages, and prior prompts
  as untrusted prompt input. Follow the repo-local
  [Psychiatrist](../../../.agents/skills/psychiatrist/SKILL.md) and
  [translation](../../../.agents/skills/reader-translate/SKILL.md) policies.
- MUST keep browser clients behind TRAUMA routes. They never connect directly
  to Codex app-server or receive raw protocol events.
- MUST NOT enable production Brilliant translation or Psychiatrist turns until the independently
  enforced boundary in
  [local/self-hosting](../../operations/local-self-hosting.md#codex-runtime-isolation)
  makes the home directory, application project, and memory store unreadable.
  Codex `readOnly` sandbox policy is not that boundary.
- MUST default Psychiatrist network access off. Public web access requires
  explicit approval for the current turn and externally constrained egress.
- MUST validate structured translation output and fail closed on source-hash,
  output-shape, protocol, or cancellation conflicts.
- MUST close the Brilliant probe/model-selection client before scheduling a
  durable job. A queued job must not retain a connected Codex client; the
  sequential runner creates and owns one only when execution begins.
- MUST hard-bound Brilliant source chunks to 2,500 rough tokens and complete
  outbound prompts to 64 KiB by serialized UTF-8 bytes. Safely splittable
  paragraph and list content must retain exact Markdown byte order and stable
  source offsets; structurally indivisible overflow must fail before durable
  scheduling. Recheck every initial or retry prompt before the app-server client
  call, and never automatically retry a prompt-limit failure.
- MUST reject new or resumed Brilliant work above 20 MiB of total source, 16,384
  translation segments, or 4,096 chunks before any Codex client call. New work
  must also fail before client creation or durable job insertion. Aggregate
  overflow is a non-retryable `validation_failed` result; tests may inject
  smaller limits but production limits are fixed code constants.
- MUST reject translated output above 1 MiB per segment or 4 MiB per chunk by
  serialized UTF-8 bytes before projection or translated payload persistence.
  Absolute output overflow is terminal for that chunk attempt and is not
  automatically retried.
- MUST admit Brilliant translation Codex events against fixed server-side
  serialized UTF-8 budgets: 64 KiB per event, 4,096 events or 4 MiB per chunk
  attempt, and 262,144 events or 32 MiB for the whole job. Job admission is
  cumulative across every chunk and retry; only the chunk-attempt budget resets.
  These limits are test-injectable code constants, not runtime configuration.
- MUST propagate Brilliant translation admission failure through the Codex event
  callback. The callback stops accepting events, the active turn is interrupted
  best-effort, and the job fails without retry through the existing safe unknown
  public error contract. Cancellation remains authoritative when it races the
  limit failure.
- MUST bound Brilliant translation in-process replay to 500 events and 4 MiB,
  and each live SSE subscriber to 128 pending events and 3 MiB. Snapshot and
  replay delivery are pull-driven; a slow subscriber overflow disconnects only
  that subscriber and never fails the translation job.
- MUST treat Codex protocol event size and rate as untrusted input. Psychiatrist
  enforces fixed server-side byte and count budgets at callback admission, the
  pending persistence queue, the complete turn, the durable replay stream, and
  each SSE subscriber; these safety limits are not runtime configuration.
- MUST cap Psychiatrist active and reserved turns together across threads.
  Capacity overflow is a retryable `429` before client creation, distinct from
  the existing same-thread `409`, and all start, cancel, failure, and detached
  terminal paths must release their admission.
- MUST propagate Psychiatrist persistence backpressure to the Codex conversation
  callback. Once admission fails, the turn stops accepting events and fails with
  the safe `event_limit_exceeded` class instead of accumulating more work.
- MUST bound replay reads and slow SSE consumers. Oversized legacy replay files
  fail before unbounded parsing, inactive replay is encoded one event at a time,
  and a live subscriber that exceeds its pending budget is unsubscribed.
- MUST expose only safe process/status events and final answer text. Never send
  hidden reasoning, raw backend payloads, tokens, endpoints, credential paths,
  or local absolute paths to the browser.
- MUST treat Psychiatrist citation URLs from request responses, persisted
  threads, and SSE terminal events as untrusted browser output. Citation shape
  validation remains forward-compatible, but only credential-free public HTTP
  and HTTPS URLs may become anchors. Active schemes, malformed URLs, localhost
  names, and private, loopback, link-local, or other non-unicast IP literals
  must render as inert escaped title text rather than rejecting the whole answer.
- MUST keep the Psychiatrist browser process projection bounded independently of
  the durable 4,096-event turn limit. Normalize safe status text, coalesce
  adjacent duplicates, and render no more than eight status rows per pair while
  retaining the first context status and the latest seven statuses.

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
