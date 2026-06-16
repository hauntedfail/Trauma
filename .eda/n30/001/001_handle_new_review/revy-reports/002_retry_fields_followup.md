# Revy Report: Retry Field Follow-Up

- Agent: `019ed249-1074-7e93-a603-a877892c2727`
- Status: success
- Scope: define concrete approved retry fields for `network_permission_required`.

## Files Changed

- `docs/workflows/task-24-psychiatrist-assistant/03-thread-storage-api-and-streaming-events.md`
- `docs/workflows/task-24-psychiatrist-assistant/04-reader-floating-dock-and-chat-ui.md`
- `docs/workflows/task-24-psychiatrist-assistant/05-safety-freshness-and-errors.md`
- `docs/workflows/task-24-psychiatrist-assistant/07-psychiatrist-skill-and-runtime-policy.md`

## Result

The docs now define HTTP fields `retry_pair_id` and `retry_turn_id`, TypeScript
helper fields `retryPairId` and `retryTurnId`, same-pair retry validation
expectations, the distinction from normal first-send approval, and test coverage
expectations for omitted or mismatched retry fields.

## Verification Reported By Revy

- `git diff --check`: passed.
- `rg -n "retry_pair_id|retryPairId|retry_turn_id|retryTurnId" docs/workflows/task-24-psychiatrist-assistant`: passed.
- Stale abstract wording check for `original retry target`: no matches in the allowed files.
