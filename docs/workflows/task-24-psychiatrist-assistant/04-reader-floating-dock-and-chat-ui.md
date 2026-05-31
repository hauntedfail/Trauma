# 24.4 Reader Floating Dock And Chat UI

## Goal

Render the reader-only Psychiatrist control as a floating iOS home-bar style
dock that expands into a compact chat surface with CSS animation.

## Files Likely Owned

- Create: `src/components/reader/PsychiatristDock.tsx`
- Create: `src/components/reader/psychiatrist-requests.ts`
- Create: `src/components/reader/psychiatrist-types.ts`
- Modify: `src/components/reader/MemoryReader.tsx`
- Modify: `src/components/reader/reader-styles.ts`
- Test: `tests/components/psychiatrist-dock.test.tsx`
- Test: `tests/components/memory-reader-actions.test.ts`
- E2E: `e2e/reader.spec.ts`
- E2E: `e2e/cross-device-responsive.spec.ts`

## UI Contract

Collapsed state:

- Fixed bottom center inside the reader viewport.
- Visual shape is a small rounded home-bar pill.
- Button label is available to assistive technology as `Open Psychiatrist`.
- The visible collapsed control does not contain explanatory feature copy.
- It is rendered only when `MemoryReader` has a ready result.

Expanded state:

- The home-bar expands upward into a chat panel using transform, opacity, and
  height transitions.
- Header text is `Psychiatrist`.
- Transcript area is bounded and scrollable.
- User messages and assistant messages have distinct alignment and surface
  treatments using existing design tokens.
- Input is a textarea with a send button. Enter sends, Shift+Enter inserts a
  newline.
- While a turn is running, the send button is disabled and a cancel action is
  visible.
- Escape closes the panel and returns focus to the home-bar trigger.
- Closing the panel does not discard the transcript for the current reader
  session.

Reduced motion:

- Under `prefers-reduced-motion: reduce`, the panel opens without transform
  animation and only fades.

## Reader Integration

Modify `ReadyMemoryReader` to render:

```tsx
<PsychiatristDock
  langCode={props.result.content.langCode}
  memoryId={props.result.memory.id}
/>
```

The component must live outside `data-reader-content` so chat UI is not treated
as Markdown content and cannot interfere with flashback text selection.

## Client Request Contract

`psychiatrist-requests.ts` owns browser fetch helpers:

```ts
export async function createPsychiatristSession(input: {
  langCode?: string;
  memoryId: string;
}): Promise<PsychiatristSessionResponse>;

export async function sendPsychiatristMessage(input: {
  clientMessageId: string;
  message: string;
  sessionId: string;
}): Promise<PsychiatristTurnStartedResponse>;

export async function cancelPsychiatristTurn(input: {
  turnId: string;
}): Promise<void>;
```

The dock connects to `event_url` with `EventSource` and appends assistant
deltas until `psychiatrist.answer.completed`.

## Tests

Component tests:

- Ready source reader renders `Open Psychiatrist`.
- Ready translated reader passes `langCode` into the dock.
- Non-ready reader fallback does not render the dock.
- Dock source contains reduced-motion styles and Escape close handling.
- Dock source keeps chat outside `data-reader-content`.
- Empty prompt does not call the message route.
- Enter sends and Shift+Enter keeps a newline.

E2E tests:

- `/memories/:id` shows collapsed dock.
- `/memories` does not show the dock.
- Clicking the home bar expands the panel.
- A fake streamed response appends assistant text to the transcript.
- Mobile viewport keeps the panel within the viewport and above bottom chrome.

Run:

```bash
mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx tests/components/memory-reader-actions.test.ts
mise exec -- bun run test:e2e e2e/reader.spec.ts e2e/cross-device-responsive.spec.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Psychiatrist is a reader-only affordance.
- The collapsed visual reads as an iOS-style home bar.
- The expanded chat is usable with keyboard, pointer, desktop, and mobile.
