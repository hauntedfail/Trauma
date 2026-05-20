# 19.6 Codex auth and device-code setup flow

## Goal

Surface Codex managed ChatGPT sign-in status and login setup without TRAUMA owning credential material.

## Scope

Implement server-side auth status detection, settings API integration, and device-code login UX through Codex app-server. Do not read or store raw Codex credential files.

## Inputs

- Task 18 settings page contract
- 19.1 auth boundary
- Codex app-server login flow, especially `chatgptDeviceCode`

## Outputs

- Auth status service returning enabled, disabled, unknown, setup_required, and error states or the frozen equivalents.
- Settings API responses that include safe setup instructions or device-code metadata.
- UI-ready state for login required, enabled, and failure cases.

## Dependencies

- 19.1 for auth boundary.
- Task 18 settings UI surface.
- 19.5 if auth detection depends on app-server connectivity.

## Acceptance criteria

- TRAUMA SQLite stores only non-secret auth metadata.
- The frontend never receives access tokens, refresh tokens, raw credential file contents, or sensitive credential paths.
- If auth is missing, the backend surfaces app-server device-code login details when supported.
- The UI can show actionable setup state for login-required cases.
- Enabling auth does not mark status as enabled until the server verifies Codex can run an authenticated operation.
- Delete auth clears or invalidates only TRAUMA-owned metadata unless Codex exposes a supported logout flow or the user configured an app-specific credential home and explicitly confirms deletion.
- Direct API requests cannot force enabled auth status without server verification.

## Parallelization notes

This can run beside 19.5 and 19.7. Coordinate API response shapes with 19.12 before frontend work starts.

## Implementation risks

- Reading `~/.codex/auth.json` creates secret-handling risk and should be avoided.
- A fake enabled state would cause translation jobs to fail later with poor UX.
- Device-code login must be treated as a setup flow, not a reason to store ChatGPT credentials in SQLite.
