# 23.4 Docs, Verification, and Handoff

Weight: S

## Objective

Document the new TOC reading-progress contract, run the full verification
baseline, and prepare the `fix/toc` handoff into `fix/perform`.

## Deliverables

- Update `docs/references/design-system/reader-and-content.md` Table Of Contents
  section with the reading-progress contract: active chapter range, background
  treatment, `aria-current`, and reduced-motion behaviour.
- Cross-check `docs/architecture/ui-and-routing.md` for any TOC description that
  needs the dynamic behaviour noted.
- Update `docs/workflows/README.md` task map to list Task 23 as a `fix/perform`
  follow-up branch, mirroring how Task 20 is recorded.
- Record verification commands and outcomes in the PR body.

## Verification

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
mise exec -- bun run test:e2e
```

If full verification is blocked by unrelated local state, record the exact
blocker and still run the focused reader/TOC suites from 23.1-23.3.

## Done When

- Docs describe the dynamic TOC behaviour.
- Verification output is captured for handoff.
- `fix/toc` is ready to merge into `fix/perform` in release order.
