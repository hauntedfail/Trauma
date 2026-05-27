# Task 19U.05: Prompt Schema And Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Change the Codex translation prompt from full Markdown block output to segment-only output.

**Architecture:** The prompt must provide segment ids and source text, then require Codex to return only `{ id, translated_text }` entries. Validation reassembles Markdown locally and runs structural fingerprint checks.

**Tech Stack:** TypeScript, Vitest, segment manifest from Task 19U.03, structure fingerprint from Task 19U.04, reader-translate skill policy.

---

## Role

Prompt schema and policy owner.

This worker must not change chunk persistence or final stitching. It owns prompt construction, Codex output schema validation, prompt policy version, and the local policy skill update.

## Files

- Modify: `src/server/translation/prompt.ts`
- Modify: `tests/server/translation/prompt.test.ts`
- Modify: `.agents/skills/reader-translate/SKILL.md`

## Task Steps

- [x] **Step 1: Write prompt schema tests**

Add tests to `tests/server/translation/prompt.test.ts`:

```ts
it("builds a segment translation prompt that does not ask Codex to return Markdown", () => {
  const chunk = createPromptChunk("Read [docs](https://example.com/docs) and `code`.\n");
  const prompt = buildTranslationPrompt({
    chunk,
    targetLanguage: "ja-JP",
  });

  expect(prompt).toContain("Return translated text segments only");
  expect(prompt).toContain("\"segments\"");
  expect(prompt).not.toContain("\"translated_markdown\"");
});

it("validates segment output and reassembles source Markdown syntax", () => {
  const chunk = createPromptChunk("Read [docs](https://example.com/docs) and `code`.\n");
  const output = validateCodexChunkOutput({
    chunk,
    output: {
      chunk_index: 0,
      segments: [
        { id: "s000001", translated_text: "読む " },
        { id: "s000002", translated_text: "ドキュメント" },
        { id: "s000003", translated_text: " と " },
      ],
      warnings: [],
    },
  });

  expect(stringifyCodexChunkOutput(output)).toBe("読む [ドキュメント](https://example.com/docs) と `code`.\n");
});
```

- [x] **Step 2: Verify RED**

Run:

```sh
mise exec -- bun run test tests/server/translation/prompt.test.ts
```

Expected:

- FAIL because current prompt schema still expects `blocks[].translated_markdown`.

- [x] **Step 3: Update prompt policy and schema**

Modify `src/server/translation/prompt.ts`:

- Set `BRILLIANT_PROMPT_POLICY_VERSION` to `brilliant-segments-v1`.
- Include segment list metadata in the prompt.
- Require this output schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["chunk_index", "segments", "warnings"],
  "properties": {
    "chunk_index": { "type": "integer" },
    "segments": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "translated_text"],
        "properties": {
          "id": { "type": "string" },
          "translated_text": { "type": "string" }
        }
      }
    },
    "warnings": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

Validation order:

1. Validate JSON shape.
2. Validate `chunk_index`.
3. Validate exact segment ids in source order.
4. Reject missing, duplicate, and unknown ids.
5. Reassemble with `applyTranslatedSegments()`.
6. Run `assertMarkdownStructurePreserved()`.
7. Run existing length-ratio checks against the reassembled output.

- [x] **Step 4: Update reader-translate skill policy**

Modify `.agents/skills/reader-translate/SKILL.md` required behavior:

```md
- Return translated text for the requested segment ids only.
- Never return full Markdown blocks unless the runtime explicitly uses the legacy block schema.
```

- [x] **Step 5: Verify this slice**

Run:

```sh
mise exec -- bun run test tests/server/translation/prompt.test.ts
mise exec -- bun run typecheck
```

Expected:

- Prompt tests pass.
- Typecheck passes.

## Handoff

Runner workers can call prompt validation and receive reassembled Markdown. They should not parse raw Codex output themselves except through prompt-domain helpers.
