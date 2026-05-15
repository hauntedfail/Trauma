# Task 18 subtasks

Implement these subtasks sequentially on `feat/memory-actions`.

## Order

1. [18.1 Data model and repository foundation](01-data-model-and-repository-foundation.md)
2. [18.2 API and mutation service layer](02-api-and-mutation-service-layer.md)
3. [18.3 Shared UI primitives](03-shared-ui-primitives.md)
4. [18.4 Browse memory item actions](04-browse-memory-item-actions.md)
5. [18.5 Right-pane taxonomy management](05-right-pane-taxonomy-management.md)
6. [18.6 Reader memory actions](06-reader-memory-actions.md)
7. [18.8 Settings page and OpenAI auth state](08-settings-page-and-openai-auth.md)
8. [18.9 Reader highlight selection and tabs](09-reader-highlight-selection-and-tabs.md)
9. [18.10 Flashback section bookmarks](10-flashback-section-bookmarks.md)
10. [18.11 Imported media display policy](11-imported-media-display-policy.md)
11. [18.12 Integration verification and handoff](12-integration-verification-and-handoff.md)

## Rules for agents

- Own only the domain named by the subtask.
- Do not pull unrelated Task 17/refine layout work into this branch.
- Preserve the existing content-store frontmatter contract.
- Prefer repository/service methods over raw SQL in route files.
- Add focused tests in the same subtask that introduces behaviour.
- Stop if a migration or filesystem deletion strategy would rewrite unrelated data.
