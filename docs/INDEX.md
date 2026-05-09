# Trauma Documentation Index

This directory is the working documentation set for Trauma.

The approved foundation spec remains the design record:

- [Foundation design](superpowers/specs/2026-05-09-trauma-foundation-design.md)
- [Execution workflows](workflows/README.md)

Use the documents below for day-to-day implementation context. They are derived
from the foundation design and should stay aligned with it.

## Architecture

- [Overview](architecture/overview.md): runtime shape, module boundaries, and
  dependency rules.
- [Data and storage](architecture/data-and-storage.md): SQLite metadata,
  markdown store, highlight persistence, and ownership of canonical state.
- [Flows](architecture/flows.md): add memory, extraction fallback, highlight,
  and git backup flows.
- [UI and routing](architecture/ui-and-routing.md): canonical routes, shell
  layout, filters, composer, and reader behavior.

## References

- [Technology stack](references/technology-stack.md): selected stack,
  exclusions, and rationale.
- [Configuration](references/configuration.md): `trauma.config.json` shape,
  validation rules, and operational meaning.
- [Coding standards](references/coding-standards.md): TypeScript, SolidStart,
  security, testing, and anti-pattern rules for implementation work.
- [Glossary](references/glossary.md): domain language and status terms.

## Operations

- [Local/self-hosting model](operations/local-self-hosting.md): expected
  deployment shape, persistent disk assumptions, and git backup behavior.

## Quality

- [Verification](quality/verification.md): E2E-first strategy and focused
  unit/integration coverage.

## Workflows

- [Task execution workflows](workflows/README.md): task-scoped worker handoff
  files for implementation PRs.

## Documentation Rules

- Keep `AGENTS.md` as a short map, not a design document.
- Put system boundaries and dependency rules under `docs/architecture/`.
- Put exact contracts, config shapes, and terminology under `docs/references/`.
- Put runtime/deployment procedures under `docs/operations/`.
- Put testing and verification expectations under `docs/quality/`.
- Update the foundation spec only when changing an approved foundation decision.
