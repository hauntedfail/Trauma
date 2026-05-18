# Task 18-alpha subtasks

Implement these subtasks on `refine/ui-routing-refresh`, based on
`workflow18-read-status`.

## Order

1. [18-alpha.1 Taxonomy rendering consolidation](01-taxonomy-rendering-consolidation.md)
2. [18-alpha.2 Shared popup shell foundation](02-shared-popup-shell-foundation.md)
3. [18-alpha.3 General action menu migration](03-general-action-menu-migration.md)
4. [18-alpha.4 Composer and Theme popup migration](04-composer-theme-popup-migration.md)
5. [18-alpha.5 Route surface alignment](05-route-surface-alignment.md)
6. [18-alpha.6 Integration verification and design docs](06-integration-verification-and-design-docs.md)

## Rules for agents

- Keep UI component contracts reusable and narrow.
- Do not change data persistence or backup behaviour.
- Do not add a new public route unless the subtask explicitly names it.
- Preserve current desktop visual design while cleaning duplicated components.
- During planning, edit only workflow files. Do not change source code, tests,
  or design-system docs until implementation is explicitly requested.
- Use shared popup chrome for popup surfaces; keep menu/composer/theme contents
  separate.
- Add focused tests in the same subtask that introduces or migrates behaviour.
- Update design-system docs only after implementation proves the final contract.
