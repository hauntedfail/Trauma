# TRAUMA Documentation Index

This is the authoritative map for current TRAUMA implementation context. Read
the smallest owning document for the work. When prose and executable behavior
disagree, verify the code and tests, then correct the owning semantic document.

## Architecture

- [Overview](architecture/overview.md): runtime shape, module boundaries, and
  dependency direction.
- [Data and storage](architecture/data-and-storage.md): canonical ownership
  across SQLite, memory-store artifacts, translations, and Psychiatrist.
- [Runtime flows](architecture/flows.md): add memory, Flashbacks, Moments,
  translation, Psychiatrist, and git backup.
- [UI and routing](architecture/ui-and-routing.md): canonical routes, shell,
  browse/filter state, reader behavior, and responsive navigation.

## References

- [Technology stack](references/technology-stack.md): selected stack,
  deployment target, exclusions, and rationale.
- [Design system](references/design-system/INDEX.md): tokens, themes, layout,
  route surfaces, icons, interaction, accessibility, and visual verification.
- [Configuration](references/configuration.md): `trauma.config.json`, path and
  backup rules, browser import, and Codex app-server environment.
- [Coding standards](references/coding-standards/INDEX.md): TypeScript,
  SolidStart, Bun, Drizzle, security, testing, and review-feedback rules.
- [Glossary](references/glossary.md): product terms and persisted status fields.

## Operations And Quality

- [Local/self-hosting](operations/local-self-hosting.md): persistent-disk
  operation, backup recovery, access control, and Psychiatrist isolation.
- [Verification](quality/verification.md): verification commands, current risk
  coverage, and the completion bar.

## Work

- [Backlog](../Backlog.md): concise durable open work.
- [Execution workflow policy](workflows/README.md): how temporary task plans and
  completed history are handled.
- [Historical workflow index](workflows/archive/README.md): completed task
  families and their current semantic owners.

## Historical Records

- [Foundation design, 2026-05-09](superpowers/specs/2026-05-09-trauma-foundation-design.md):
  superseded pre-implementation record retained for historical context only.

Historical records are not implementation specifications. Current architecture,
reference, operations, quality docs, code, and tests take precedence.

## Documentation Rules

- Keep `AGENTS.md`, `CLAUDE.md`, and `README.md` as short entry points.
- Put durable system behavior in the owning architecture, reference,
  operations, or quality document.
- Keep one owner for a contract and link to it instead of copying it.
- Track open outcomes in `Backlog.md`; delete completed task plans after moving
  durable requirements to semantic docs.
- Use Git history for execution chronology, review transcripts, commit lists,
  and superseded implementation plans.
