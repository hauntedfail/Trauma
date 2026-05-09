# Coding Standards Index

This directory defines Trauma's implementation rules. Read the files that match
the code you are changing.

The project uses ECC common rules and TypeScript extensions as strict defaults.
When a generic ECC rule conflicts with Trauma's stack, these local rules win.
The most important stack-specific override is that Trauma is SolidStart/Solid,
not React.

## Rule Levels

- MUST: review blocker unless the PR explains a narrow, necessary exception.
- SHOULD: default approach. Deviations need a short reason in the PR.
- AVOID: recognized smell. Treat as forbidden unless the alternative is worse
  and the PR explains why.

## Reading Map

- [Principles](principles.md): implementation values, ownership, readability,
  and exception policy.
- [TypeScript](typescript.md): strictness, `unknown`, assertions, indexed
  access, and type-only imports.
- [SolidStart UI](solidstart-ui.md): Solid reactivity, component boundaries,
  props, effects, and cleanup.
- [Bun runtime](bun-runtime.md): package manager rules, lockfile, Bun types,
  and runtime/resource lifecycle.
- [Drizzle and SQLite](drizzle-sqlite.md): schema, migrations, SQL safety,
  repository boundaries, and transactions.
- [Security boundaries](security-boundaries.md): trust-boundary validation,
  markdown/HTML safety, path safety, and errors.
- [Testing and verification](testing-verification.md): required checks and test
  expectations.
- [Anti-patterns](anti-patterns.md): prohibited patterns across the project.
- [Review learnings](review-learnings.md): recurring mistakes observed in
  merged PR review threads and their durable prevention rules.

## Source Basis

The rules are grounded in the official docs for the active stack:

- Bun TypeScript compiler options, Bun type definitions, lockfile handling, and
  SQLite connection behavior.
- TypeScript `unknown` and strict indexed access behavior.
- Solid props reactivity, memo purity, cleanup lifecycle, and `on` utility
  behavior.
- Drizzle codebase-first migrations, relations, transactions, and `sql`
  template usage.

## Review Feedback Loop

Valid review feedback that exposes a reproducible mistake should become a
durable rule, test, or shared contract. Use
[Review learnings](review-learnings.md) as the place for patterns that workers
should check before opening later PRs.
