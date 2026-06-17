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
- Transcript state is loaded as prompt/response pairs. The UI may render each
  pair as a user bubble followed by an assistant bubble or status row, but the
  client model keeps `pairId`, `turnId`, pair `status`, `userPrompt`, and
  optional `assistantResponse` together.
- User prompts and assistant responses have distinct alignment and surface
  treatments using existing design tokens.
- Assistant responses render answer text and safe process/reasoning stream rows
  as they arrive. Process rows must be visually subordinate to the answer and
  must never show hidden chain-of-thought or raw backend payloads.
- Input is a textarea with a send button. Enter sends, Shift+Enter inserts a
  newline.
- While a turn is running, the submit button becomes a Stop button. The input is
  disabled for new prompts on that thread, but the existing running pair remains
  visible and keeps streaming.
- Stop calls the cancel route. No other UI action, including panel close,
  Escape, route navigation, memory switch, or reload, should cancel the turn.
- Each completed assistant response renders a Regenerate button. Clicking it
  reruns that exact pair's stored prompt and stored context, keeps the same
  `pairId`, and replaces the displayed response with the regenerated stream.
- If the server returns `network_permission_required`, show a compact
  per-turn approval action for web search/source lookup. Approval retries the
  same pair with `web_source_permission: "allow_for_this_turn"`, the original
  `retry_pair_id`, and the original `retry_turn_id`; denial leaves network
  disabled.
- Escape closes the panel and returns focus to the home-bar trigger.
- Closing the panel does not discard the transcript for the current reader
  thread.
- Leaving the memory route and later returning to the same memory resumes the
  thread and replays any active stream from storage.
- Reloading the browser resumes the latest matching memory-local thread and
  reconnects to `active_turn.event_url` when a turn is still running.

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
export async function createPsychiatristThread(input: {
  langCode?: string;
  memoryId: string;
  resumeLatest?: boolean;
}): Promise<PsychiatristThreadResponse>;

export async function sendPsychiatristMessage(input: {
  clientMessageId: string;
  langCode?: string;
  message: string;
  memoryId: string;
  retryPairId?: string;
  retryTurnId?: string;
  threadId: string;
  webSourcePermission?: "deny" | "allow_for_this_turn";
}): Promise<PsychiatristTurnStartedResponse>;

export async function cancelPsychiatristTurn(input: {
  turnId: string;
}): Promise<void>;

export async function regeneratePsychiatristResponse(input: {
  langCode?: string;
  memoryId: string;
  pairId: string;
  threadId: string;
  webSourcePermission?: "deny" | "allow_for_this_turn";
}): Promise<PsychiatristTurnStartedResponse>;
```

The dock connects to `event_url` with `EventSource`, replays persisted stream
events, and appends safe process rows plus assistant deltas until
`psychiatrist.answer.completed`, `psychiatrist.regenerate.completed`, failure,
or Stop.

On reader mount, the dock calls `createPsychiatristThread()` with
`resumeLatest: true` so the newest non-stale memory-local thread can be loaded
from `{storePath}/memories/{memoryId}/threads/`. If no matching thread exists,
the server creates a new thread.

The thread API returns stored pairs. `PsychiatristDock` converts them into
display rows without losing the pair relationship so retry, cancel, and stale
status actions can target the correct `pairId` and `turnId`.

Every send carries the active reader identity: `memoryId`, optional `langCode`
for translated readers, and `threadId`. If the reader switches memory or
translation variant while the component has stale state, the server rejects the
send before context building and the dock refreshes the active thread.

`retryPairId` and `retryTurnId` are sent only when the UI is approving a
same-pair retry after `network_permission_required`. A normal first send with
explicit web-source approval omits both fields. When the approval action is a
retry, `sendPsychiatristMessage()` maps `retryPairId` to `retry_pair_id` and
`retryTurnId` to `retry_turn_id`; the route rejects the request if either field
is missing or does not match the original thread, pair, turn, accepted prompt,
memory id, and active variant identity.

If the thread response contains `active_turn`, `PsychiatristDock` immediately
sets the submit button to Stop and reconnects to the active event URL. It must
not create a new thread or resend the prompt just because the component mounted
again after navigation or reload.

Regenerate display rules:

- The Regenerate button is visible only on completed assistant responses.
- Clicking Regenerate disables other sends on the thread, switches the submit
  control to Stop, and starts streaming into the same pair row.
- The previous response may remain visible with a regenerating status until the
  first new answer delta arrives; after that, the visible response is replaced
  by the regenerated response for the same pair.
- If Regenerate fails or is stopped, the UI keeps the last completed response
  and shows the safe failure/stopped status for that pair.
- If Regenerate returns `network_permission_required`, the UI keeps the last
  completed response visible, overlays the waiting-for-approval status for that
  same pair, and approval retries the scoped regenerate route for the same
  `memoryId`, `threadId`, `pairId`, and variant identity.

## Tests

Component tests:

- Ready source reader renders `Open Psychiatrist`.
- Ready translated reader passes `langCode` into the dock.
- Non-ready reader fallback does not render the dock.
- Dock source contains reduced-motion styles and Escape close handling.
- Dock source keeps chat outside `data-reader-content`.
- Empty prompt does not call the message route.
- Enter sends and Shift+Enter keeps a newline.
- Running state replaces the submit button with Stop.
- Stop calls `cancelPsychiatristTurn()` exactly once and only after explicit
  click.
- Closing the panel, pressing Escape, unmounting the reader, switching memory,
  and remounting do not call `cancelPsychiatristTurn()`.
- Opening the dock loads stored thread pairs returned by the thread API and
  renders completed pairs as user/assistant rows.
- Opening a thread with `active_turn` reconnects to its event URL and replays
  stored process/answer events.
- Safe process stream events render in the active assistant response.
- Hidden-chain-of-thought placeholder events are ignored or rendered as a safe
  generic status, never as raw reasoning text.
- Completed assistant responses render a Regenerate button.
- Clicking Regenerate calls `regeneratePsychiatristResponse()` with the active
  `memoryId`, active `threadId`, existing `pairId`, and active `langCode` when
  present, not `sendPsychiatristMessage()`.
- Failed or stopped Regenerate leaves the previous completed response visible.
- Network-permission-required Regenerate leaves the previous completed response
  visible and shows a same-pair approval state.
- Web-source approval sends only `web_source_permission:
  "allow_for_this_turn"` plus `retryPairId` and `retryTurnId` for the
  same-pair active retry, omits retry fields for a normal first approved send,
  and never persists a global network preference.

E2E tests:

- `/memories/:id` shows collapsed dock.
- `/memories` does not show the dock.
- Clicking the home bar expands the panel.
- A fake streamed response appends process text and assistant text to the active
  pair.
- The fake streamed response persists the user prompt and completed answer as
  one pair under the memory-local `threads/` subtree.
- A running fake stream continues after navigating away to `/memories` and back
  to the same reader.
- A running fake stream continues after browser reload and reconnects to the
  same `turn_id`.
- Stop cancels a running fake stream only after the Stop button is clicked.
- Regenerate reruns a completed response for the same `pairId` and shows the
  replacement response without adding a new pair row.
- A fake network-required response keeps network disabled until the user
  approves the per-turn web-source retry action for the same pair.
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
