# Review Learnings

This document persists recurring mistakes found in merged PR review threads.
Treat these as coding-standard extensions, not one-off historical notes.

## Reviewed Sample

| PR | Area | Resolved review themes |
| --- | --- | --- |
| #1 | Config and persistence foundation | Runtime adapter mismatch, missing database constraints, migration lifecycle, config path scope, resource cleanup |
| #2 | Markdown store | Atomic writes, temp-file uniqueness, CRLF/BOM/frontmatter parsing edge cases |
| #3 | Coding standards refactor | Duplicated key lists, local replacement for upstream Bun SQLite types |
| #4 | Markdown status contract | Serialized field naming, duplicated validation, drift between shared status constants and SQL constraints |
| #5 | URL importer and add memory workflow | Bounded fetch lifecycle, SSRF edge cases, markdown escaping, browser-visible errors, partial memory creation failures |

## Recurring Patterns

| Pattern | Evidence | Rule |
| --- | --- | --- |
| Single-source-of-truth drift | Status values and frontmatter keys were duplicated across unions, guards, schema checks, and parsers. | Domain constants, type guards, validation, frontmatter serialization, and database constraints MUST derive from one source or have an explicit drift test. |
| Runtime boundary mismatch | Bun SQLite code carried incomplete Node/sqlite-proxy fallback behavior and local constructor types. | Do not add portability fallbacks unless the complete adapter contract is implemented and tested. Prefer upstream runtime types. |
| Persistence invariants enforced too late | Repositories were exposed before migrations and some status invariants existed only as TypeScript types. | Initialization MUST apply migrations and persisted constraints before returning repositories or clients. |
| Path and cwd assumptions | Relative config paths, bundled migrations, and database/store containment checks used the wrong base. | Resolve paths from explicit config or module locations, not incidental `process.cwd()`, unless cwd is part of the contract. |
| Git-backed markdown edge cases | LF-only parsing, BOM rejection, trailing-newline assumptions, and predictable temp paths made content artifacts fragile. | Markdown artifacts MUST tolerate common Git/editor output and writer temp paths MUST be collision-resistant and cleaned up on failure. |
| Error surface mismatch | Errors used internal TypeScript field names or collapsed distinct failure classes. | User-facing and artifact-facing errors MUST name serialized fields and preserve the relevant failure class. |
| Importer trust-boundary gaps | URL fetches and HTML-to-markdown conversion accepted edge-case inputs beyond the intended public HTTP(S) contract. | Importers MUST bound remote I/O, validate every fetched or persisted URL against the public-host policy, and escape text-node markdown before writing `CONTENT.md`. |
| Multi-step create ambiguity | A memory row and markdown file could survive while the caller observed a failed create after post-insert backup-status work. | Once memory metadata and content are durable, later boundary failures MUST return the created memory or compensate explicitly; callers must not receive an ambiguous failed create. |
| Review fixes without durable guardrails | Several valid review points required follow-up tests or central constants. | Accepted review fixes MUST add focused regression coverage or centralize the contract so the same mistake is hard to repeat. |

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
