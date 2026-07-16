# Task 22: Vim-Like Memory Browse Keybindings Workflow

## Goal

Add vim-like keyboard operation to the `/memories` browse route so a user can
move through visible memories, focus search, exit search, and open the selected
memory without using the mouse.

## Required Context

- [Project orientation](../../INDEX.md)
- [UI and routing architecture](../../architecture/ui-and-routing.md)
- [Interaction and accessibility](../../references/design-system/interaction-and-accessibility.md)
- [Verification strategy](../../quality/verification.md)
- [Coding standards](../../references/coding-standards/INDEX.md)

## Ownership

Primary files:

- `src/components/memories/MemoryBrowse.tsx`
- `src/components/memories/MemorySearchBar.tsx`
- `e2e/browse-shell.spec.ts`
- `tests/components/memory-browse-actions.test.ts`
- `docs/workflows/README.md`

Do not change reader keyboard behaviour, global shell navigation, storage,
backup, importer, or translation logic in this task.

## Interaction Contract

- On `/memories`, `j` moves the browse cursor to the next visible memory.
- On `/memories`, `k` moves the browse cursor to the previous visible memory.
- Cursor movement clamps at the first and last visible memory.
- The selected memory receives a visible selected/focus treatment and is
  scrolled into view when navigation moves it.
- `/` focuses the search input and selects no text.
- While the search input or another text field is focused, printable vim keys
  are treated as normal text input.
- `Escape` in the search input blurs the input and returns focus to browse
  operation.
- `l` and `Enter` open the selected memory using the same href as the row title
  link.
- Keyboard handling must not trigger while a dialog, menu, text field, or
  contenteditable surface owns the interaction.
- Existing native link focus and row click behaviour must keep working.

## Implementation Steps

1. Add a failing Playwright test for the keyboard contract.
   - Use `/memories` fixture data.
   - Press `j` and assert the first memory becomes selected.
   - Press `j` again and assert the second visible memory becomes selected.
   - Press `k` and assert selection returns to the first visible memory.
   - Press `/` and assert `Search memories` is focused.
   - Type a character in search and assert it becomes query text instead of
     moving the selection.
   - Press `Escape`, then `l`, and assert navigation opens the selected memory.

2. Add a focused component/source contract test for the new browse keyboard
   plumbing.
   - Assert the browse source has document keydown setup and cleanup.
   - Assert row markup exposes selected state through stable attributes.
   - Assert search bar exposes a focusable input hook and Escape blur handler.

3. Implement the browse cursor state in `MemoryBrowse`.
   - Store the selected memory id instead of only an index so filtering and
     deletion can preserve selection when possible.
   - Derive selected index from `visibleMemories`.
   - Clamp movement when the list is empty or the selected memory disappears.
   - Keep refs for row links so selected rows can be focused or scrolled.

4. Implement route-level key handling.
   - Register one `document` keydown listener from `MemoryBrowse` on mount.
   - Ignore events from text-entry controls, contenteditable elements, dialogs,
     and menus, except for search Escape handled by `MemorySearchBar`.
   - On `/`, prevent default and focus the search input.
   - On `j` or `k`, prevent default and move the selected memory.
   - On `l` or `Enter`, prevent default and navigate to the selected memory href.

5. Preserve accessible row behaviour.
   - Keep the row title as the canonical link.
   - Keep nested controls stopping propagation.
   - Add a selected state class/data attribute without changing card layout.
   - Avoid replacing native links with non-native keyboard-only controls.

6. Verify the focused path.
   - Run `bun run typecheck`.
   - Run `bun run test -- tests/components/memory-browse-actions.test.ts`.
   - Run `bun run test:e2e -- e2e/browse-shell.spec.ts`.

## Acceptance Criteria

- `j` and `k` move the selected memory through visible `/memories` rows.
- `/` focuses the search bar.
- `Escape` exits search focus and returns to browse operation.
- `l` and `Enter` open the selected memory.
- Typing in the search field is never hijacked by browse keybindings.
- Dialogs, menus, and text-entry controls keep their own keyboard behaviour.
- Existing row click, title link click, and focused title link Enter behaviour
  still pass.

## Verification

Run:

```bash
bun run typecheck
bun run test -- tests/components/memory-browse-actions.test.ts
bun run test:e2e -- e2e/browse-shell.spec.ts
```

If this touches shared key handling unexpectedly, also run:

```bash
bun run test
```

## PR Handoff

The PR description must include:

- The route-level keyboard contract.
- How text-input and overlay focus are excluded from vim-like key handling.
- Exact verification commands and outcomes.
