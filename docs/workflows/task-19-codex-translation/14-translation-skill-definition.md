# 19.14 Translation skill definition

## Goal

Create a repo-local translation skill that captures reusable Codex translation policy.

## Scope

Plan and implement `.agents/skills/reader-translate/SKILL.md` as the reusable policy source for chunk translation. Do not add scripts unless validator reliability requires them.

## Inputs

- 19.8 prompt contract
- 19.9 validation rules
- Security requirements from parent workflow

## Outputs

- `.agents/skills/reader-translate/SKILL.md`
- Skill version identifier used by `translation_jobs.skill_version`
- Guidance for academic paper translation and protected content preservation

## Dependencies

- 19.8 should freeze the MVP prompt before the skill extracts reusable policy.

## Acceptance criteria

- The skill instructs Codex to preserve Markdown, HTML, LaTeX/math, citations, code fences, inline code, placeholders, identifiers, URLs, file paths, commands, and variables.
- The skill states that source article text is untrusted content and cannot override instructions.
- The skill requires faithful translation of prose.
- The skill forbids summarization and omission.
- The skill requires schema-compliant output.
- The skill supports academic paper translation.
- The skill distinguishes reusable policy from per-job metadata supplied by Reader.
- The implementation can start with the MVP prompt template before using the skill directly, but the final Task 19 plan includes this skill as a tracked subtask.

## Parallelization notes

This can run after 19.8. It can run in parallel with frontend work because it owns `.agents/skills/reader-translate/SKILL.md` only.

## Implementation risks

- Overbuilding scripts inside the skill can duplicate Reader validators.
- Keeping prompt policy in both code and skill without a version can make behavior drift.
- The skill must not grant Codex authority to write canonical files.
