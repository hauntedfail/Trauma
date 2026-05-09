# Trauma Project Instructions

Trauma is a TypeScript bookmark management app that uses the domain terms
`memory` for one bookmark and `memories` for the collection.

## Current Foundation Decisions

- Use SolidStart, Bun, Drizzle ORM, and SQLite.
- Do not introduce Next.js, PostgreSQL, external queues, serverless-first
  deployment assumptions, or auth/user ownership in the initial scope.
- Treat the app as a single-user local/self-hosted web app deployable to a
  single VPS or home server with persistent local disk.
- Keep implementation modular inside one SolidStart app: config, DB
  repositories, importer, markdown store, backup queue, reader pipeline, and UI
  shell should remain separate responsibilities.
- Store canonical metadata in SQLite. Do not git-backup the SQLite database file.
- Store readable memory content as markdown under
  `storePath/memories/{uuid-v7}/CONTENT.md`.
- Use built-in git backup only for the markdown store and related content files.
- Preserve the X-like app shell: shared left navigation, center content, and
  right filter panel, with drawers on narrow screens.
- Do not add auth in the initial implementation. Future auth/signup policy must
  be handled by a separate design.

## Documentation Workflow

- Before implementation work, keep the foundation spec in
  `docs/superpowers/specs/2026-05-09-trauma-foundation-design.md` aligned with
  decisions.
- Do not scaffold or implement features until the design is approved and an
  implementation plan has been written.
