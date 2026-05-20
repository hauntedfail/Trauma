# Workflow 19 Review: Brilliant — Codex app-server translation pipeline

**Reviewed:** 2026-05-21  
**Reviewer:** Claude (pre-implementation gate review)  
**Scope:** All files under `docs/workflows/task-19-codex-translation/` plus parent README, against `TASK_19_INSTRUCTION.md` acceptance criteria (lines 706–725) and security requirements (lines 1–705).  
**Verdict:** **HISTORICAL REVIEW SNAPSHOT.** The canonical implementation plan is `docs/workflows/task-19-codex-translation/README.md` plus `00-execution-contracts.md` and the focused contracts under `docs/workflows/task-19-codex-translation/contracts/`. Findings below may be superseded by later plan edits.

---

## 1. Files reviewed

| File | Role |
|------|------|
| `TASK_19_INSTRUCTION.md` | Root INSTRUCT, authoritative acceptance criteria |
| `docs/workflows/task-19-codex-translation.md` | Parent README / Brilliant overview |
| `…/00-execution-contracts.md` | Contract routing index |
| `contracts/README.md` | Contract directory index |
| `contracts/01-architecture-and-ownership.md` | File ownership map |
| `contracts/02-types-state-and-settings.md` | TypeScript types, state machines |
| `contracts/03-sqlite-and-repositories.md` | DDL, repository signatures |
| `contracts/04-api-and-sse.md` | API shapes, SSE, error codes |
| `contracts/05-markdown-chunking.md` | Block scanner, chunking defaults |
| `contracts/06-codex-prompt-and-validation.md` | Client interface, prompt, validation |
| `contracts/07-atomic-commit-purge-recovery.md` | Commit sequence, purge, recovery |
| Subtask files `01` through `17` | Goal, ownership, contract ref, tests, acceptance criteria per subtask |

---

## 2. INSTRUCT acceptance criteria verdicts

| # | Criterion | Verdict | Where satisfied |
|---|-----------|---------|-----------------|
| 1 | Uses `memory/<memory_id>/<lang_code>/CONTENT.md` | **Satisfied (with intentional divergence noted)** | Parent README line 33–34 explicitly maps conceptual `memory/…` → plural `memories/…`; contracts/07 and contracts/04 use `memories/<memory_id>/<lang_code>/CONTENT.md` throughout. Divergence is intentional and documented. |
| 2 | Uses `ja-JP`-style BCP 47 language codes | **Satisfied** | contracts/02 defines `SUPPORTED_TRANSLATION_LANGUAGES` with BCP 47 codes; contracts/04 uses `ja-JP` in all examples; parent README line 38. |
| 3 | Does not introduce `.work/<job_id>` | **Satisfied** | Parent README line 41 states this explicitly. contracts/07 uses `.CONTENT.<job_id>.tmp` for atomic write only; no `.work/` directory anywhere. |
| 4 | Allows temporary SQLite chunk storage during translation | **Satisfied** | contracts/03 DDL includes `translated_markdown TEXT` column; contracts/07 purge step is post-commit only. |
| 5 | Requires immediate purge of translated chunk bodies after final commit | **Satisfied** | contracts/07 step 12: same-transaction purge; purge SQL explicit. Parent README lines 43–44. |
| 6 | Uses atomic final file write | **Satisfied** | contracts/07 steps 6–9: same-directory temp → flush → rename → dir flush. |
| 7 | Supports long documents and academic papers through deterministic chunking | **Satisfied** | contracts/05: 16-step block scanner, stable `b000001` ids, `maxRoughTokens: 2500`, section-boundary preference, oversized-block handling. Subtask 04 owns implementation. |
| 8 | Includes frontend streaming progress | **Satisfied** | Parent README: SSE default; contracts/04: full event envelope + 15 named event types; subtask 07 owns bridge. |
| 9 | Uses Codex app-server as preferred integration path | **Satisfied** | Parent README lines 22–29; contracts/06: JSON-RPC 2.0 `initialize`/`thread/start`/`turn/start` lifecycle; `CodexAppServerClient` interface. |
| 10 | Keeps Codex tokens out of the frontend | **Satisfied** | contracts/06 explicit rules; contracts/02 types/settings contract. Multiple explicit `NEVER` statements. `translation_unavailable` error path does not leak credential info. |
| 11 | Treats external article content as untrusted data | **Satisfied** | contracts/06 prompt sections require: role as data processor, security framing, explicit delimiters around source content. contracts/06 rules: "network/tool access disabled for translation turns if app-server exposes such controls". |
| 12 | Defines validation and retry at chunk level | **Satisfied** | contracts/06: 13-step validation algorithm per chunk; retry behavior section: increment `retry_count`, include failures in retry prompt, fail after `maxRetries`. |
| 13 | Defines final stitching and full-document validation | **Satisfied** | contracts/07 step 3 (stitch in block order), step 4 (validate final full document). Subtask 10 owns implementation. |
| 14 | Includes a future `reader-translate` skill subtask | **Satisfied** | Subtask 14 (`14-translation-skill-definition.md`) defines the skill document. Parent README lists it explicitly at position 14. |
| 15 | Produces numbered subtasks with dependencies and parallelization notes | **Satisfied** | Parent README: 18 numbered subtasks (0–17); parallelization map (Tracks A–F); dependency order stated per track. |
| 16 | Does not start implementation unless explicitly authorized | **Satisfied** | Parent README line 173: "Do not start implementation until the plan is accepted." Status block line 5: "ready for implementation after this workflow is accepted." |

**All 16 criteria satisfied.**

---

## 3. Security requirements alignment

The INSTRUCT states security requirements across lines 1–705. This review checks the most critical ones.

| Requirement | Status | Contract reference |
|-------------|--------|--------------------|
| Source content wrapped in explicit delimiters | Satisfied | contracts/06 prompt section 8: "Source chunk inside explicit delimiters" |
| Source content declared as data, not instructions | Satisfied | contracts/06 prompt section 2: security framing; section 1: role as faithful translation worker |
| Never let source content override system instructions | Satisfied | Prompt section order (2 before 8) + explicit security prompt section |
| Disable network/tool access for translation turns if possible | Satisfied | contracts/06 rule: "Disable network/tool access for translation turns if app-server exposes such controls" |
| Codex must not write canonical files | Satisfied | contracts/06 rule: "Do not let Codex write files" |
| Codex app-server not exposed to browser | Satisfied | contracts/06 rule: "Do not expose app-server URL, token, or raw auth state to the browser"; contracts/02 types contract |
| Reader backend is the only Codex client | Satisfied | Parent README line 26; contracts/01 ownership map |
| OpenAI/ChatGPT tokens never enter frontend, SQLite, or logs | Satisfied | contracts/02: explicit token exclusion from schema; contracts/06 auth contract; `chatgptAuthTokens` mode excluded |
| Do not persist partial streamed deltas as completed translation | Satisfied | contracts/06 rule: "Final output must come from completed item content and pass schema validation"; parent README line 127 |

---

## 4. Intentional divergences from INSTRUCT

These are deliberate plan decisions, not defects.

### 4.1 Path plural: `memories/` vs `memory/`

INSTRUCT uses conceptual singular `memory/<memory_id>/...`. The plan uses TRAUMA's existing store layout `memories/<memory_id>/...`.

**Documented:** Parent README line 34; `00-execution-contracts.md`.  
**Verdict:** Correct. TRAUMA's `storePath` has always used the plural form. Any agent implementing subtasks must follow the plural form.

### 4.2 Extended job status values: `unavailable` and `stale`

INSTRUCT defines job states `pending / running / cancel_requested / canceled / stitching / committing / complete / failed`. The plan adds `unavailable` (complete job whose output file is missing or hash-mismatched) and `stale` (source changed under a non-complete job).

**Verdict:** Necessary operational additions. `unavailable` prevents silently serving stale or missing output. `stale` gives a precise, actionable terminal state. Both have corresponding error codes in contracts/04 and recovery cases in contracts/07. No INSTRUCT rule prohibits them.

### 4.3 Settings dependency

Parent README declares a dependency on "merged `/settings` page, SQLite-backed BCP 47 target-language setting, and current OpenAI auth settings boundary."

**Verified present:**  
- `src/routes/settings.tsx` exists  
- `src/routes/api/settings/translation-language.ts` exists  
- `src/server/db/schema.ts` contains `lang_code`/`translation_target` references  

**Verdict:** Dependency satisfied in codebase. Not a blocker.

### 4.4 Frontmatter preservation

INSTRUCT does not specify frontmatter handling. The plan adds explicit preservation: contracts/05 step 1 parses frontmatter separately and stitching prepends raw bytes unchanged.

**Verdict:** Necessary addition. Without it, any frontmatter in source `CONTENT.md` would be lost or incorrectly assigned a block id and translated. The plan correctly scopes frontmatter as metadata-only.

### 4.5 `outputSchema` fallback chain

INSTRUCT does not define a fallback when the app-server rejects structured output. The plan adds: try `outputSchema` → fall back to prompt-only JSON → fail chunk with `invalid_final_output` if both fail.

**Verdict:** Correct defensive design for MVP compatibility. Well-specified in contracts/06.

### 4.6 `resolveCurrentTranslation()` and `repairUnavailableTranslation()` split

INSTRUCT does not specify this boundary. The plan introduces a read-only resolver shared by reader route, tabs, and API, and a separate mutating repair function scoped to API/job-start boundaries only.

**Verdict:** Good design. Prevents accidental mutation from read-path code.

---

## 5. Weaknesses and risks (non-blocking)

These are not blockers for implementation authorization but must be tracked.

### 5.1 Omission-marker detection is brittle

contracts/06 validation step 12 checks for strings `omitted`, `summary`, `summarized`, `省略`, `要約`, `...`. These are heuristic string matches that can produce:

- **False positives**: legitimate translated text containing "要約" as a section title.
- **False negatives**: novel omission patterns not in the list (e.g., Chinese/Korean equivalents, `[...]`, `[cut]`).

**Recommendation:** Implement as a configurable list with a strict mode (warn only vs. fail). Log the matched string and block id so implementors can tune the list from real failures.

### 5.2 Concurrent POST race for the same `(memory_id, lang_code)` not fully specified

contracts/04 uses the unique partial index `(memory_id, lang_code, source_hash) WHERE status = 'complete'` and an active-states index. But two simultaneous `POST /api/memories/:id/translations` requests with the same `(memory_id, lang_code)` could create two `pending` jobs before either transitions to `running`. The contracts define "reuse active job" behavior but do not specify whether the serialization happens at SQLite level (advisory lock, unique constraint) or at application level (mutex, queue).

**Recommendation:** Subtask 03 (state machine) or 15 (error handling) should add an explicit "at most one active job per (memory_id, lang_code)" invariant with a concrete serialization mechanism.

### 5.3 `outputSchema` fallback is only specified for app-server rejection, not for model refusal

If the app-server accepts `outputSchema` but the model returns output that fails JSON validation on the first attempt, retry is used. If the model cannot produce valid JSON across all retries, the chunk fails with `invalid_final_output`. This path is correct. However, there is no specified behavior for partial JSON that passes schema but fails semantic validation (e.g., wrong block ids). The validation algorithm handles this case (steps 3–4) but the error code assigned is `validation_failed`, not `invalid_final_output`. Subtask 09 implementors should confirm error code assignment at the chunk level is consistent with the API error codes in contracts/04.

### 5.4 `translation.job.snapshot` reconnect — no durable event replay

contracts/04 states: "On reconnect, emit `translation.job.snapshot` first using current SQLite job/chunk state, then stream new events." But "stream new events" means events emitted after the reconnect — any events fired while the client was disconnected between the snapshot and re-subscription are lost.

For MVP this is acceptable (the snapshot covers state). Flag for subtask 07 to document this gap explicitly so future implementors do not assume replay coverage.

### 5.5 `repairUnavailableTranslation()` ownership

**Resolved after this review snapshot.** `repairUnavailableTranslation()` is now owned by 19.3 through `src/server/translation/current-translation.ts`. 19.11 recovery reuses that helper instead of implementing a second unavailable-repair path.

**Canonical source:** use the focused contracts and subtask files, not this historical note, when implementing unavailable repair.

### 5.6 Oversized single block handling is deferred

contracts/05: "If a single block exceeds `maxRoughTokens`, mark the chunk as oversized and let Codex validation/retry handle context errors." This means a large `code_fence` or `math_block` may fail and exhaust retries without any recovery path.

**Recommendation:** Subtask 04 or 17 should add a test fixture with an oversized block and specify the observable failure mode (chunk fails with `context_overflow`, job fails) so it is not silently swallowed.

---

## 6. Out-of-scope items (not part of this review)

The following were mentioned in earlier project context but are not part of Workflow 19:

- `bun run dev` crash (exit code 1) — separate debugging workflow needed
- Test suite improvements — not part of Brilliant planning
- GitHub Actions CI/CD review — not part of Brilliant planning
- Agent-doc automation — not part of Brilliant planning

These require separate workflow definitions.

---

## 7. Open questions

Per INSTRUCT line 725: "Open questions should be minimal and only include issues that block implementation."

**No blocking open questions found.**

The plan fully specifies: storage layout, state machine, chunking algorithm, Codex protocol, auth flow, streaming, validation, retry, atomic commit, purge, recovery, frontend integration, and reader routes. All INSTRUCT decisions are captured. The settings dependency is verified in the codebase.

The weaknesses in §5 are tracked risks for subtask implementors, not pre-implementation blockers.

---

## 8. Conclusion

Workflow 19 satisfies all 16 INSTRUCT acceptance criteria and all stated security requirements. Intentional divergences from INSTRUCT are documented and justified. No blocking issues found.

**The plan is ready for implementation authorization.**

Implementation must begin with subtask 19.1 (requirements and architecture finalization), which reads all contracts before any code is written. Subtask implementors must follow the file ownership map in contracts/01 and the path mapping note in the parent README (plural `memories/`).

The five risks in §5 should be addressed as the relevant subtasks are implemented: §5.2 by subtask 03/15, §5.5 by subtask 11, §5.6 by subtask 04/17.
