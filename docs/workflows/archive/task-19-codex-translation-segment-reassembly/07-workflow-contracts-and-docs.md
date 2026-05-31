# Task 19U.07: Workflow Contracts And Docs Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove stale scratch-parser and block-output claims from Task 19 workflow contracts.

**Architecture:** Documentation must match the new runtime contract: parser-backed segment extraction, segment-only Codex output, deterministic reassembly, and parser-backed structural validation.

**Tech Stack:** Markdown docs, `rg`, `git diff --check`.

---

## Role

Workflow contract owner.

This worker must not modify runtime code. It only updates durable docs after code subtasks define the final contracts.

## Files

- Modify: `docs/workflows/task-19-codex-translation/04-markdown-block-manifest-and-chunker.md`
- Modify: `docs/workflows/task-19-codex-translation/08-chunk-translation-prompt-and-output-schema.md`
- Modify: `docs/workflows/task-19-codex-translation/09-chunk-validation-and-retry-logic.md`
- Modify: `docs/workflows/task-19-codex-translation/contracts/05-markdown-chunking.md`
- Modify: `docs/workflows/task-19-codex-translation/contracts/06-codex-prompt-and-validation.md`

## Task Steps

- [x] **Step 1: Update Markdown chunking contract**

Replace line-oriented parser language with:

```md
Markdown parsing is parser-backed. The implementation must not attempt to cover the Markdown dialect through ad hoc regex scanning. Line-oriented fallback logic may exist only for controlled diagnostics or migration compatibility.
```

- [x] **Step 2: Update prompt output contract**

Replace block-output examples with:

```json
{
  "chunk_index": 0,
  "segments": [
    { "id": "s000001", "translated_text": "翻訳されたテキスト" }
  ],
  "warnings": []
}
```

- [x] **Step 3: Update validation contract**

Document these primary validation steps:

- Segment id and count validation.
- Deterministic reassembly from original source Markdown.
- Parser-backed structural fingerprint comparison.
- Regex protected spans are legacy guardrails, not the primary correctness mechanism.

- [x] **Step 4: Verify docs references**

Run:

```sh
rg -n "translated_markdown|scan Markdown line by line|protected spans are used by validation" docs/workflows/task-19-codex-translation docs/workflows/task-19-codex-translation.md
git diff --check -- docs/workflows/task-19-codex-translation docs/workflows/task-19-codex-translation.md
```

Expected:

- Remaining `translated_markdown` mentions are explicitly labeled legacy storage or temporary reassembled chunk storage.
- No contract requires full scratch Markdown parsing.
- No whitespace errors.

## Handoff

E2E verification can use updated docs as the canonical Task 19U contract. If implementation and docs conflict, the worker must stop and report the exact file and line mismatch.
