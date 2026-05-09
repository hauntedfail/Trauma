# Review Learnings

This document persists recurring mistakes found in merged or handoff-ready PR
review threads. Treat these as coding-standard extensions, not one-off
historical notes.

## Reviewed Sample

| PR | Area | Resolved review themes |
| --- | --- | --- |
| #1 | Config and persistence foundation | Runtime adapter mismatch, missing database constraints, migration lifecycle, config path scope, resource cleanup |
| #2 | Markdown store | Atomic writes, temp-file uniqueness, CRLF/BOM/frontmatter parsing edge cases |
| #3 | Coding standards refactor | Duplicated key lists, local replacement for upstream Bun SQLite types |
| #4 | Markdown status contract | Serialized field naming, duplicated validation, drift between shared status constants and SQL constraints |
| #5 | URL importer and add memory workflow | Bounded fetch lifecycle, SSRF edge cases, markdown escaping, browser-visible errors, partial memory creation failures |
| #7 | Browse shell and filters | Production fixture leakage, missing route targets, query filter edge cases, responsive drawer reachability, highlight anchor drift, hidden global composer, swallowed runtime adapter failures |

## Recurring Patterns

| Pattern | Evidence | Rule |
| --- | --- | --- |
| Single-source-of-truth drift | Status values and frontmatter keys were duplicated across unions, guards, schema checks, and parsers. | Domain constants, type guards, validation, frontmatter serialization, and database constraints MUST derive from one source or have an explicit drift test. |
| Runtime boundary mismatch | Bun SQLite code carried incomplete Node/sqlite-proxy fallback behavior and local constructor types. | Do not add portability fallbacks unless the complete adapter contract is implemented and tested. Prefer upstream runtime types. |
| Persistence invariants enforced too late | Repositories were exposed before migrations and some status invariants existed only as TypeScript types. | Initialization MUST apply migrations and persisted constraints before returning repositories or clients. |
| Path and cwd assumptions | Relative config paths, bundled migrations, and database/store containment checks used the wrong base. | Resolve paths from explicit config or module locations, not incidental `process.cwd()`, unless cwd is part of the contract. |
| FileRoutes helper leakage | A pure reader helper was placed under `src/routes`, where SolidStart can treat it as a route module. | Keep helper modules outside the FileRoutes tree; route directories should contain route modules only. |
| Embed permission leakage | Markdown sanitization allowed host-validated iframes but preserved author-controlled `allow` permissions. | Sanitizers MUST normalize or remove iframe capability attributes even when iframe hosts are allowlisted. |
| Git-backed markdown edge cases | LF-only parsing, BOM rejection, trailing-newline assumptions, and predictable temp paths made content artifacts fragile. | Markdown artifacts MUST tolerate common Git/editor output and writer temp paths MUST be collision-resistant and cleaned up on failure. |
| Error surface mismatch | Errors used internal TypeScript field names or collapsed distinct failure classes. | User-facing and artifact-facing errors MUST name serialized fields and preserve the relevant failure class. |
| Importer trust-boundary gaps | URL fetches and HTML-to-markdown conversion accepted edge-case inputs beyond the intended public HTTP(S) contract. | Importers MUST bound remote I/O, validate every fetched or persisted URL against the public-host policy, and escape text-node markdown before writing `CONTENT.md`. |
| Multi-step create ambiguity | A memory row and markdown file could survive while the caller observed a failed create after post-insert backup-status work. | Once memory metadata and content are durable, later boundary failures MUST return the created memory or compensate explicitly; callers must not receive an ambiguous failed create. |
| Boundary normalization drift | Request parsers trimmed values for one guard but passed the original value into deeper validation. | Normalize external scalar inputs once at the boundary, then validate and pass only the normalized value inward. |
| Review fixes without durable guardrails | Several valid review points required follow-up tests or central constants. | Accepted review fixes MUST add focused regression coverage or centralize the contract so the same mistake is hard to repeat. |
| Fixture leakage into production UI | Browse shell data initially rendered deterministic example memories for every self-hosted instance. | Route and shell UI MUST load production state from repository/server boundaries; fixtures MUST be test-only or gated by an explicit test/runtime flag. |
| Fatal runtime failures rendered as empty state | Missing Bun SQLite runtime errors and missing required config were initially collapsed into an empty browse result. | Empty states MUST represent valid empty product data, not failed required runtime adapters, required config, or broken storage initialization. |
| Navigation without implemented targets | Shell links and browse actions pointed at routes or anchors that did not exist yet. | Visible navigation, action links, and deep links MUST resolve to implemented routes and concrete anchor targets, even when the target is a scoped placeholder. |
| Filter state drift | Browse query parsing, clearing, highlight shortcut ordering, and right-panel shortcut semantics had different assumptions across UI and data helpers. | Query-backed filters MUST parse and normalize every supported parameter consistently, support clearing one active filter without resetting unrelated state, apply shortcut-specific canonical URL contracts, and sort recency shortcuts by the recency field they claim to represent before limiting. |
| Responsive controls lost across breakpoints | The right filter panel could be hidden before the drawer trigger became visible, duplicate drawer/panel IDs created ambiguous labels, and drawer navigation could remain mounted after route selection. | Responsive shell breakpoints MUST preserve access to every collapsed workflow, concurrently mounted desktop/drawer UI MUST use distinct IDs for labels and controls, and drawer route selections MUST close the transient drawer state. |
| Global actions hidden in route-local UI | The add-memory composer existed only on the browse route while shell routes introduced by the task could not reach it. | Foundation-global actions MUST live in the shared shell or another route-independent surface, not only in a page-local panel. |
| Weak layout assertions | A Playwright dimension comparison could pass when both measured boxes were `null`. | Layout-sensitive Playwright tests MUST assert the target is visible and measured values are non-null before comparing dimensions. |

## Persistent Rules

- MUST convert accepted review feedback into a test, shared contract, or
  documented rule when the mistake is reproducible.
- MUST reply to review threads with the concrete fix and verification outcome
  before treating review follow-up as complete.
- MUST re-sweep review threads after pushing fixes; a clean CI state is not
  evidence that all actionable review feedback was addressed.
- MUST prefer thread-aware GitHub review inspection over flat PR comment reads
  when determining whether review feedback is resolved.
- SHOULD update this document when a merged PR reveals a new recurring
  anti-pattern.
