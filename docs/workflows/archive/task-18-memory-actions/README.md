# Task 18 subtasks

Implement these subtasks sequentially on `feat/task-18-memory-actions`.

## Order

1. [18.1 Data model and repository foundation](01-data-model-and-repository-foundation.md)
2. [18.2 API and mutation service layer](02-api-and-mutation-service-layer.md)
3. [18.3 Shared UI primitives](03-shared-ui-primitives.md)
4. [18.4 Browse memory item actions](04-browse-memory-item-actions.md)
5. [18.5 Right-pane taxonomy management](05-right-pane-taxonomy-management.md)
6. [18.6 Reader memory actions](06-reader-memory-actions.md)
7. [18.8 Settings page and OpenAI auth state](08-settings-page-and-openai-auth.md)
8. [18.9 Reader Flashback marker selection and tabs](09-reader-flashback-marker-selection-and-tabs.md)
9. [18.10 Moment section bookmarks](10-moment-section-bookmarks.md)
10. [18.11 Imported media display policy](11-imported-media-display-policy.md)
11. [18.12 Integration verification and handoff](12-integration-verification-and-handoff.md)
12. [18.13 Review follow-up implementation alignment](13-review-followup-implementation-alignment.md)
13. [18.14 Product language migration](14-product-language-migration.md)
14. [18.15 Memory delete consistency and backup hardening](15-memory-delete-consistency-and-backup-hardening.md)
15. [18.16 PR review follow-up: cache, Flashback backup, and stale anchors](16-pr-review-followup-cache-and-backup.md)

## Rules for agents

- Own only the domain named by the subtask.
- Do not pull unrelated Task 17/refine layout work into this branch.
- Preserve the existing content-store frontmatter contract.
- Use current product language: Flashback means text marker, Moment means section bookmark.
- Prefer repository/service methods over raw SQL in route files.
- Add focused tests in the same subtask that introduces behaviour.
- Stop if a migration or filesystem deletion strategy would rewrite unrelated data.
