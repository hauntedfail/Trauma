# 18.12 Integration verification and handoff

## Goal

Run cross-domain verification after subtasks 18.1 through 18.11 are complete. This subtask should not add new feature scope except fixes required by failed verification.

## Files likely owned

- tests touched by prior subtasks
- optional Playwright/E2E coverage if the project already has a suitable flow
- PR description / handoff notes

## Required integration checks

Manual smoke:

1. Start from an existing database with memories.
2. Confirm existing memories appear unread after migration.
3. Add a new memory and confirm it is unread.
4. Toggle a memory to read on `/memories`.
5. Open the reader and confirm it shows read.
6. Toggle back to unread in the reader.
7. Return to `/memories` and confirm unread.
8. Create `New tag` from the right pane.
9. Create `New category` from the right pane.
10. Attach a tag to a memory from the browse footer `Add tag`.
11. Attach a category to a memory from the memory action menu.
12. Confirm right-pane taxonomy lists include all records.
13. Confirm taxonomy sort follows count, recent assignment, name.
14. Confirm reader renders only the active memory's taxonomy.
15. Confirm a link-only memory renders `Link-only` and not `Saved`.
16. Delete a memory from `/memories`.
17. Confirm it disappears without refresh.
18. Confirm SQLite memory metadata is gone.
19. Confirm the content directory under `storePath` is gone.
20. Confirm git backup records a deletion for the removed content path when backup is enabled.
21. Delete a memory from reader mode.
22. Confirm the app navigates to `/memories`.
23. Open `/settings`.
24. Change translation target language and confirm the persisted API response uses BCP 47, for example `ja-JP`.
25. Enable OpenAI auth from disabled state only when a real provider or stored auth record is available.
26. If no real OpenAI auth provider exists, confirm enable returns not-configured and does not fake enabled state.
27. Send a direct enable request while already enabled and confirm the response is already-enabled without mutation.
28. Delete OpenAI auth and confirm UI returns to disabled state.
29. Select repeated text in reader content and confirm no highlight is created until the highlight icon is clicked.
30. Click the highlight icon and confirm only the selected occurrence is highlighted.
31. Confirm `CONTENT.md` did not change after creating/removing the highlight.
32. Confirm highlight `contentHash` uses the documented `sha256:<hex>` canonical-text format.
33. Confirm SQLite-only highlight metadata has a backup/export path, or that restore-risk is explicitly documented if deferred.
34. Confirm reader highlight tabs render `All highlights` on the left and `This memory` second.
35. Confirm `/memories` recent highlight component is unchanged.
36. Create a Flashback from a reader section hover icon.
37. Create a Flashback from a ToC chapter hover icon.
38. Long-press a reader section and confirm the shared contextual menu contains Flashback.
39. Select arbitrary body text and confirm the contextual menu does not contain Flashback.
40. Confirm the Flashback create API rejects missing or ambiguous section anchors/paths.
41. Open `/flashback` and confirm the saved Flashbacks are listed.
42. Click a Flashback and confirm it navigates to the memory section anchor.
43. Import content containing a cross-host HTTPS image and confirm the image is preserved.
44. Import content containing a Medium-style `<picture>` with `miro.medium.com` image fallback and confirm the image is preserved.
45. Import content containing a controlled HTTPS iframe and confirm the reader sanitizer renders it with sandbox/referrer controls.
46. Confirm default iframe sandbox does not include `allow-same-origin`.
47. Confirm unsafe iframe forms such as `srcdoc`, `http:`, event handlers, or local hosts are rejected or stripped.

## Regression risks to check

- `CONTENT.md` frontmatter did not gain tags/categories/read.
- `CONTENT.md` body is not rewritten for highlight persistence.
- SQLite-only highlight persistence has backup/export coverage or an explicit restore-risk note.
- Highlights still render in reader mode.
- Highlight toggle/removal still persists if existing behaviour supports it.
- Browse category/tag filters still work.
- Browser import/add memory flow still creates memories.
- Backup queue still stages content paths only.
- Normal memory deletion has an explicit backup deletion path and does not leave deleted `CONTENT.md` tracked for restore.
- Backup failsafe delete-missing-record remains distinct from normal memory delete.
- Full taxonomy right pane does not disappear under active filters.
- Settings API does not return OpenAI credential material.
- Flashbacks do not modify `CONTENT.md`.
- Flashbacks cascade when the owning memory is deleted.
- Flashback create validates section identity server-side before insert.
- Cross-host HTTPS article images are preserved.
- Controlled HTTPS iframes are preserved without unsafe attributes.
- Controlled HTTPS iframes do not use `allow-same-origin` by default.

## Commands

Targeted suite:

```sh
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/db/repositories.test.ts
mise exec -- bun run test tests/server/routes/api-memory-read-status.test.ts
mise exec -- bun run test tests/server/routes/api-memory-delete.test.ts
mise exec -- bun run test tests/server/routes/api-taxonomy.test.ts
mise exec -- bun run test tests/server/routes/api-settings.test.ts
mise exec -- bun run test tests/server/routes/api-flashbacks.test.ts
mise exec -- bun run test tests/server/routes/api-highlights.test.ts
mise exec -- bun run test tests/server/importer/importer.test.ts
mise exec -- bun run test tests/server/reader/markdown-renderer.test.ts
mise exec -- bun run test tests/server/routes/api-browser-import.test.ts
mise exec -- bun run test tests/server/reader/page-data.test.ts
mise exec -- bun run test tests/server/highlights/toggle.test.ts
mise exec -- bun run test tests/server/highlights/ranges.test.ts
mise exec -- bun run test tests/server/highlights/highlight-markers.test.ts
mise exec -- bun run test tests/server/settings/settings.test.ts
mise exec -- bun run test tests/memories/browse-data.test.ts
mise exec -- bun run test tests/components/memory-action-menu.test.tsx
mise exec -- bun run test tests/components/memory-read-status.test.tsx
mise exec -- bun run test tests/components/taxonomy-create-popover.test.tsx
mise exec -- bun run test tests/components/memory-browse-actions.test.tsx
mise exec -- bun run test tests/components/app-shell-taxonomy.test.tsx
mise exec -- bun run test tests/components/memory-reader-actions.test.tsx
mise exec -- bun run test tests/components/settings-page.test.tsx
mise exec -- bun run test tests/components/memory-reader-highlight-selection.test.tsx
mise exec -- bun run test tests/components/reader-highlight-tabs.test.tsx
mise exec -- bun run test tests/components/reader-flashback-actions.test.tsx
mise exec -- bun run test tests/components/flashback-route.test.tsx
mise exec -- bun run test tests/browser-extension/capture.test.ts
```

Full project verification:

```sh
mise exec -- bun run verify
```

Optional E2E if local browser verification is available:

```sh
mise exec -- bun run test:e2e
```

## PR handoff checklist

PR body must include:

- schema/migration summary
- API summary
- deletion consistency strategy
- backup deletion strategy for removed memory content
- highlight record strategy
- highlight metadata backup/export strategy or explicit restore-risk
- Flashback section identity strategy
- settings/OpenAI auth validation strategy
- UI summary
- imported media validation strategy
- exact verification commands and outcomes
- any known deferred items, especially category/tag rename/delete, bulk actions, or richer OpenAI auth provider work

## Acceptance criteria

- All Task 18 subtasks are implemented.
- Full verification passes or failures are documented with clear blocker status.
- The PR does not include unrelated refine layout changes.
- The final behaviour matches the original Task 18 intent without relying on hidden branch state.
