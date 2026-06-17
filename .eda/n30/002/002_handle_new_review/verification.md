# Verification

Run directory: `.eda/n30/002/002_handle_new_review`

## Commands

- `git diff --check`: passed.
- `rg -n "network_permission_required|revision_kind: \"network_permission_required\"|selected Markdown text|exact rendered prompt input|pairId|pairs/:pairId/regenerate|regeneratePsychiatristResponse|24\\.7|24\\.6" docs/workflows/task-24-psychiatrist-assistant`: passed; confirmed the updated Task 24 contract terms.
- `rg -n "psychiatrist-pairs/:pairId/regenerate|regeneratePsychiatristResponse\\(\\{ pairId \\}\\)|/api/memories/:memoryId/psychiatrist/threads/:threadId/turns|/api/memories/:memoryId/psychiatrist/threads/:threadId$" docs/workflows/task-24-psychiatrist-assistant`: passed with no matches; the stale global Regenerate helper/route and over-scoped event/cancel/read route patterns are absent.
- `MISE_TRUSTED_CONFIG_PATHS=/private/tmp/trauma-pr30-review-docs/mise.toml mise exec -- bun run typecheck`: passed (`tsc --noEmit` exited 0).

## Caveats

- `mise exec` emitted a tracked-config symlink warning because the sandbox cannot write to `/Users/vvx/.local/state/mise/tracked-configs/...`. This did not block typecheck.

