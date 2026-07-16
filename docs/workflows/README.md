# TRAUMA Execution Workflow Policy

Current durable open work lives in [Backlog.md](../../Backlog.md). There are no
long-lived task execution plans in this directory.

For implementation work:

1. Start from [docs/INDEX.md](../INDEX.md) and read the owning semantic docs.
2. Create a temporary task/PR plan only when the change needs coordination.
3. Keep each unit domain-scoped and include tests with behavior changes.
4. Run the verification justified by
   [the verification strategy](../quality/verification.md).
5. Move lasting contracts into architecture, reference, operations, or quality
   docs, update Backlog state, then delete the temporary plan.

Completed task narratives, worker handoffs, commit lists, review transcripts,
and superseded file-by-file plans belong in Git history. The concise
[historical workflow index](archive/README.md) maps completed task families to
their current semantic owners; it is not an implementation source.
