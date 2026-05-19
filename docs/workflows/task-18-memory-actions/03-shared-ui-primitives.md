# 18.3 Shared UI primitives

## Goal

Create or extract reusable UI primitives needed by browse and reader pages. This subtask should establish components, not wire all final page behaviour.

## Files likely owned

- `src/components/memories/MemoryActionMenu.tsx`
- `src/components/memories/MemoryReadStatusControl.tsx`
- `src/components/memories/TaxonomyCreatePopover.tsx`
- optional `src/components/memories/memory-actions.ts`
- `tests/components/memory-action-menu.test.tsx`
- `tests/components/memory-read-status.test.tsx`
- `tests/components/taxonomy-create-popover.test.tsx`

## Memory action menu contract

Create one reusable memory-level meatballs menu component.

If a browse memory menu already exists on the implementation branch:

- extract it without changing visual intent
- keep browse using the extracted component
- expose props needed by reader

If no menu exists:

- create a new `MemoryActionMenu` component
- use a three-dot/meatballs trigger
- keep it generic enough for browse and reader

Required props:

```ts
{
  memoryId: string;
  memoryTitle: string;
  onDelete?: (memoryId: string) => Promise<void> | void;
  onAttachCategoryByName?: (input: { memoryId: string; name: string }) => Promise<void> | void;
  disabled?: boolean;
  class?: string;
}
```

Required menu items:

- `Delete memory`
- `Add category`

Rules:

- `Delete memory` requires confirmation.
- `Add category` opens the shared taxonomy popover in category mode.
- Do not create a separate reader-only menu.
- The trigger must be keyboard accessible.
- Escape closes the menu/popover.
- Clicking outside closes the menu/popover if existing project patterns support it.

## Read status control contract

Create `MemoryReadStatusControl`.

Props:

```ts
{
  memoryId: string;
  initialRead: boolean;
  compact?: boolean;
  class?: string;
  onChange?: (read: boolean) => void;
}
```

Behaviour:

- Render visible label `Read` or `Unread`.
- Render action text `Mark unread` when currently read.
- Render action text `Mark read` when currently unread.
- Use `aria-pressed`.
- Disable while request is in flight.
- Optimistically update local state.
- Revert and show a small inline error when the API fails.

## Taxonomy create popover contract

Create one shared popover component for:

- right-pane `New category`
- right-pane `New tag`
- browse-footer `Add tag`
- memory-menu `Add category`

Props:

```ts
{
  title: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmitName: (name: string) => Promise<void> | void;
  onClose: () => void;
}
```

Behaviour:

- Focuses the input when opened.
- Trims input.
- Rejects empty input client-side.
- Enter submits.
- Icon button next to input submits.
- Shows a small inline error on failure.
- Does not decide whether the operation is create-only or create-and-attach; parent handlers decide.

## Tests

Cover:

- menu renders trigger and required items
- delete item calls confirmation path before mutation callback
- add category opens taxonomy popover
- read status renders initial state
- read status toggles with optimistic UI
- read status reverts on request failure
- taxonomy popover submits on Enter
- taxonomy popover rejects empty names
- taxonomy popover calls `onSubmitName` with trimmed value

## Verification

```sh
mise exec -- bun run test tests/components/memory-action-menu.test.tsx
mise exec -- bun run test tests/components/memory-read-status.test.tsx
mise exec -- bun run test tests/components/taxonomy-create-popover.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Browse and reader can use the same action menu component.
- Taxonomy create/attach UI can use the same popover component.
- Components are behaviour-ready but not over-coupled to a single page.

