# Principles

Trauma favors clean, boring implementation over cleverness.

## Implementation Values

- Keep modules small, cohesive, and domain-oriented.
- Make data ownership obvious.
- Prefer explicit contracts over inference from incidental behavior.
- Avoid hidden side effects and implicit runtime coupling.
- Preserve local-first operation and low maintenance cost.
- Prefer early returns, named helpers, and linear control flow over deeply
  nested conditionals.
- Keep parsing, validation, transformation, persistence, and rendering as
  separate phases.
- Prefer discriminated options objects over boolean flag APIs when a function
  has more than one mode.
- Convert reproducible review mistakes into durable tests, shared contracts, or
  coding-standard rules.

## State And Data Ownership

- MUST keep canonical ownership clear:
  - SQLite owns metadata.
  - Markdown files own extracted readable content.
  - The UI owns transient presentation state.
- MUST NOT duplicate canonical state across SQLite and markdown unless a
  documented sync rule says which side wins.
- MUST update data immutably in UI and domain transformations.
- MUST model status fields as explicit unions and enforce persisted constraints
  where possible.
- MUST keep domain values and serialized keys in one source of truth when they
  are used by validators, schemas, frontmatter, migrations, and UI filters.
- SHOULD prefer small DTOs at module boundaries rather than leaking ORM rows
  through the entire app.

## Dependencies

- MUST justify every new runtime dependency in the PR.
- MUST prefer existing stack tools: Bun, SolidStart, Solid, Drizzle, Vitest, and
  Playwright.
- MUST NOT add large frameworks, state libraries, UI kits, queues, or service
  SDKs unless the task design explicitly calls for them.
- SHOULD prefer standard APIs or small local utilities when they keep the
  maintenance surface smaller.

## Exception Policy

Exceptions are allowed only when they are narrow, intentional, and reviewable.
The PR must state:

- Which rule is being bypassed.
- Why the clean default is worse in this case.
- How the exception is constrained.
- What verification was run.
