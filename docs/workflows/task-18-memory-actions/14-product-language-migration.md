# 18.14 Product language migration

## Goal

Change TRAUMA product language consistently across docs and define the
implementation impact for `feat/task-18-memory-actions`.

The product language changes from:

```text
flashback: marker
Flashback: bookmark
```

to:

```text
Flashback: marker
Moment: bookmark
```

This file is the workflow plan for aligning implementation after the docs
language change. This branch edits docs only. SQLite schema, route, API, and
component changes are implemented on `feat/task-18-memory-actions`.

## Canonical terms

`Flashback`
: A user-created text marker inside reader content. This replaces the older
product term `flashback`.

`Moment`
: A saved reader section/chapter bookmark. This replaces the older use of
`Flashback` for section bookmarks.

Legacy terms:

- `flashback` means old text-marker language and must not appear in new
  user-facing docs or UI copy except in migration notes.
- `bookmark` may describe generic behaviour, but user-facing product copy should
  use `Moment`.
- Older `Flashback` bookmark language must migrate to `Moment`.

## Documentation impact inventory

The docs search surface currently includes these areas:

- `docs/architecture/`
- `docs/references/design-system/`
- `docs/references/glossary.md`
- `docs/quality/verification.md`
- `docs/operations/local-self-hosting.md`
- `docs/superpowers/specs/2026-05-09-trauma-foundation-design.md`
- `docs/workflows/README.md`
- `docs/workflows/task-18-memory-read-status.md`
- `docs/workflows/task-18-memory-actions/`
- active workflow files that still describe flashback or Flashback behaviour

Docs that are historical execution records may keep legacy terms only when the
legacy term is clearly historical. Durable architecture, reference, design, and
active workflow docs must use the new product language.

## Implementation impact inventory

The implementation branch must account for the following likely rename surfaces.

SQLite/data model:

- Old marker table/records: `flashbacks`
- New marker product concept: Flashbacks
- Old bookmark table/records planned as `flashbacks`
- New bookmark product concept: Moments
- Decide whether physical table names migrate now or whether compatibility
  aliases are kept temporarily.
- If renaming tables, provide migrations that preserve existing rows.
- If keeping legacy table names for implementation safety, ensure API/UI/product
  language exposes `Flashback` and `Moment` while documenting the technical debt.

Routes/API:

- Old marker route: `/flashbacks`
- New marker route: `/flashbacks`
- Old section-bookmark route: `/flashback`
- New section-bookmark route: `/moments`
- Old marker API names likely under `/api/flashbacks`
- New marker API names should become `/api/flashbacks` or provide a compatibility
  bridge.
- Old bookmark API planned under `/api/flashbacks`
- New bookmark API should become `/api/moments`
- Add redirects or compatibility routes only if needed for existing saved links.

Components:

- `FlashbackExcerpt` becomes Flashback excerpt language.
- Memories right-rail Flashback shortcuts use the island title `Flashback`.
- Reader flashback selection menu becomes Flashback marker selection.
- Flashback section bookmark UI becomes Moment UI.
- Flashback icon attached to headings/ToC becomes Moment icon.
- `/flashback` route components become Moments route components.

Tests:

- Rename user-facing assertions from flashback to Flashback.
- Rename section-bookmark assertions from Flashback to Moment.
- Keep implementation-level legacy names only where compatibility is deliberate.

## Execution plan

1. Merge `workflow18-read-status` into `feat/task-18-memory-actions`.
2. Audit current implementation names for marker and section-bookmark surfaces.
3. Decide whether database tables are renamed immediately or wrapped by
   product-language API aliases.
4. Rename user-facing marker language from flashback to Flashback.
5. Rename section-bookmark language from Flashback/bookmark to Moment.
6. Update routes and navigation to the chosen canonical paths.
7. Add compatibility redirects if old routes may already be linked.
8. Update tests to assert the new product language.
9. Update durable docs after implementation decisions are known.

## Required implementation decisions

Table naming:

- Preferred final state is `flashbacks` for marker records and `moments` for
  section bookmarks.
- If this is too risky for the current implementation branch, use compatibility
  adapters and record a follow-up debt item.

Route naming:

- Preferred final state is `/flashbacks` for marker browsing and `/moments` for
  section bookmarks.
- If old routes remain, they should redirect or be explicitly marked legacy.

Type naming:

- Product-facing types should use `Flashback` and `Moment`.
- Internal transitional names are acceptable only behind repository/service
  boundaries.

Backup/export naming:

- Flashback metadata backup/export from 18.13 becomes Flashback metadata
  backup/export.
- Moment backup/deletion strategy must follow the section-bookmark data model,
  not the old Flashback bookmark language.

## Docs edit checklist

Durable docs:

- Update architecture docs to describe Flashbacks as text markers.
- Update architecture docs to describe Moments as section bookmarks.
- Update UI/routing docs for `/flashbacks` and `/moments`.
- Update data/storage docs for marker/bookmark schema ownership.
- Update quality docs for Flashback marker and Moment bookmark verification.
- Update design-system docs for labels, tabs, icons, excerpts, and navigation.
- Update glossary and foundation design references.

Workflow docs:

- Update Task 18 overview and subtask names.
- Update 18.9 from reader flashback selection to Flashback marker selection.
- Update 18.10 from Flashback section bookmarks to Moment section bookmarks.
- Update 18.12 integration checklist.
- Update 18.13 follow-up plan terms.
- Keep explicit migration notes for implementation agents so old code names can
  be mapped safely.

## Acceptance criteria

- User-facing docs consistently use Flashback for text markers.
- User-facing docs consistently use Moment for section bookmarks.
- Any remaining `flashback` usage is explicitly legacy, code-path, syntax
  flashbacking, or migration terminology.
- Any remaining `bookmark` usage is generic behaviour or explicitly mapped to
  Moment.
- Implementation branch has a clear schema/API/component migration checklist.
- Task 19 docs are not modified by this Task 18 product-language migration
  unless the user explicitly reopens Task 19.
