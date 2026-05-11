# Task 16a: Tailwind Migration Workflow

## Status

Archived after the Tailwind migration landed on `triage`.

This archive preserves the styling contract and migration rules. It does not
track PR numbers, branch history, commit hashes, or review chronology.

Git branch names must not use `triage/...` while a `triage` branch exists.

## Goal

Move Trauma's component styling from `src/styles/app.css` to Tailwind CSS.
`app.css` must stop being the place where UI behavior is encoded; styling should
live on the component markup as readable Tailwind classes.

## Decision

Tailwind is compatible with this stack because SolidStart exposes Vite config
through `app.config.ts`, and Tailwind v4 provides a Vite plugin. Trauma uses
Tailwind v4 with `@tailwindcss/vite`. `@tailwindcss/typography` is included for
rendered markdown because reader HTML arrives through `innerHTML`.

Current styling contract:

- `app.config.ts` installs `tailwindcss()` in the SolidStart Vite config.
- `src/app.tsx` imports `src/styles/tailwind.css`.
- `src/styles/tailwind.css` is the only global CSS entry.
- `src/styles/app.css` is removed.
- `src/components/reader/reader-styles.ts` owns shared static reader class
  strings that would be too noisy inline.

## Scope

Modified:

- `package.json`
- `bun.lock`
- `app.config.ts`
- `src/app.tsx`
- `src/styles/app.css`
- `src/styles/tailwind.css`
- `src/components/shell/AppShell.tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/reader-styles.ts`
- `src/routes/highlights/index.tsx`
- `src/routes/[...404].tsx`
- `src/routes/memories/[id].tsx`
- `tests/scripts/tailwind-migration.test.ts`
- `docs/references/technology-stack.md`

Out of scope:

- Component redesign.
- Route behavior changes.
- New UI state.
- Server, database, importer, backup, or reader parsing changes.

## Durable Migration Rules

- Do not recreate `app.css` as a pile of Tailwind `@apply` selectors.
- Prefer component-local `class` strings and Solid `classList` with full static
  class names.
- Keep dynamic values out of generated class names. Use literal alternatives:
  `classList={{ "bg-trauma-bg-surface": active(), "bg-transparent": !active() }}`.
- Use Tailwind theme tokens for Trauma colors instead of raw repeated hex
  values.
- Limit arbitrary selectors to rendered markdown HTML, where the element markup
  cannot be edited directly.
- Keep semantic class names only when tests or accessibility hooks require them.
  Do not keep them solely for styling.

## Verification

Run during implementation and review:

```bash
mise exec -- bun run verify
mise exec -- bun run test:e2e
mise exec -- bun run dev:smoke
```

The PR also introduced `tests/scripts/tailwind-migration.test.ts` so the removed
stylesheet and global CSS entry contract stay checked.
