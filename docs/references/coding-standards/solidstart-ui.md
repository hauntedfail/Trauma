# SolidStart UI Rules

## SolidStart And UI Code

- MUST NOT introduce React-specific assumptions, hooks, router APIs, or state
  patterns.
- MUST keep server-only code out of client bundles. Filesystem, SQLite, git, and
  extraction code belong behind server modules or server functions.
- MUST keep non-route helper modules outside `src/routes` when `<FileRoutes />`
  is active. Files under the route tree must be actual route modules.
- MUST NOT use Solid `createEffect` for derived state, data transformation, or
  user-triggered actions.
- MUST reserve `createEffect` for real side effects such as subscriptions,
  external integrations, or DOM/browser APIs that cannot be represented as
  declarative JSX.
- MUST use plain accessors/functions or `createMemo` for derived values.
- MUST keep `createMemo` pure. Do not call setters, mutate state, fetch, write
  storage, or trigger external effects from a memo.
- MUST put explicit user actions in event handlers or server actions, not in an
  effect that happens to observe state.
- MUST NOT destructure Solid props in a way that breaks reactivity. Use
  accessors such as `() => props.value` or `splitProps` when props need to be
  grouped.
- MUST register `onCleanup` for event listeners, timers, subscriptions, or
  resources created inside components or reactive scopes.
- MUST pass accessor functions to Solid's `on` utility for store properties,
  such as `on(() => state.value, handler)`.
- SHOULD use route data, server functions, or `createResource` for async data
  loading depending on whether the data is server-owned or client-only.
- SHOULD keep components mostly presentational. Move persistence, extraction,
  markdown, and backup behavior into server/domain modules.
- AVOID component-level duplication of server state. Derive view state from
  route data, params, query state, or local UI signals.
