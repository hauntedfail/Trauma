import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PsychiatristThreadStoreError,
  appendAssistantResponse,
  appendPendingPair,
  appendRetriedAssistantResponse,
  appendRegeneratedAssistantResponse,
  createPsychiatristThread,
  failNextThreadManifestUpdateForTests,
  findLatestPsychiatristThread,
  loadPsychiatristThread,
  markPsychiatristRegenerateFailed,
  markPsychiatristTurnCanceled,
  markPsychiatristTurnCompleted,
  markPsychiatristTurnFailed,
  markPsychiatristThreadStale,
  reconcileInactivePsychiatristTurns,
  recoverCompletedPsychiatristArtifactsForMemory,
  recordPsychiatristTurnStarted,
} from "../../../src/server/psychiatrist/thread-store";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
import {
  appendPsychiatristStreamEvent,
  loadPsychiatristStreamReplay,
} from "../../../src/server/psychiatrist/stream-store";
import type {
  PsychiatristContextSnapshotManifest,
  PsychiatristThreadManifest,
} from "../../../src/server/psychiatrist/types";

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";
const THREAD_ID_2 = "019e8a00-0000-7000-8000-000000000004";
const PAIR_ID = "019e8a00-0000-7000-8000-000000000002";
const TURN_ID = "019e8a00-0000-7000-8000-000000000003";

describe("Psychiatrist thread store", () => {
  it("creates source thread artifacts under the owning memory directory", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-thread-"));

    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });

    const manifestJson = JSON.parse(
      await readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.json"),
        "utf8",
      ),
    );
    expect(manifestJson).toMatchObject({
      active_content_hash: "sha256:source",
      memory_id: MEMORY_ID,
      policy_version: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      status: "ready",
      thread_id: THREAD_ID,
      variant_kind: "source",
    });
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md"),
        "utf8",
      ),
    ).resolves.toContain("# Psychiatrist Thread");
  });

  it("appends pending and completed pair revisions in chronological order", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-pairs-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "The memory says rollback is missing.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    const pairsJsonl = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    );
    const rows = pairsJsonl.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed"]);
    expect(rows[0]).toMatchObject({
      pair_id: PAIR_ID,
      status: "pending",
      user_prompt: "What is the risk?",
    });
    expect(rows[1]).toMatchObject({
      assistant_response: "The memory says rollback is missing.",
      pair_id: PAIR_ID,
      response_markdown_path: `memories/${MEMORY_ID}/threads/${THREAD_ID}/pairs/${PAIR_ID}/RESPONSE.md`,
      status: "completed",
    });
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "PROMPT.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("What is the risk?");
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "RESPONSE.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("The memory says rollback is missing.");

    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({
          content: "The memory says rollback is missing.",
        }),
        pairId: PAIR_ID,
        status: "completed",
        user: expect.objectContaining({ content: "What is the risk?" }),
      }),
    ]);
    const manifestJson = JSON.parse(
      await readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.json"),
        "utf8",
      ),
    );
    expect(manifestJson.updated_at).not.toBe("2026-06-01T00:00:00.000Z");
  });

  it("restores RESPONSE.md from the latest durable completed pair revision", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-response-recovery-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is durable?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "The pair revision is durable.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    const responsePath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "RESPONSE.md",
    );
    await writeFile(responsePath, "uncommitted regenerated response", "utf8");

    await expect(recoverCompletedPsychiatristArtifactsForMemory({
      config: { storePath },
      memoryId: MEMORY_ID,
    })).resolves.toBe(1);
    await expect(readFile(responsePath, "utf8")).resolves.toBe(
      "The pair revision is durable.",
    );
  });

  it("removes an orphan RESPONSE.md when no completed pair revision exists", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-orphan-response-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is durable?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const responsePath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "RESPONSE.md",
    );
    await writeFile(responsePath, "response written before its pair row", "utf8");

    await expect(recoverCompletedPsychiatristArtifactsForMemory({
      config: { storePath },
      memoryId: MEMORY_ID,
    })).resolves.toBe(1);
    await expect(readFile(responsePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a torn final pair revision before appending the next row", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-pairs-torn-tail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const pairsPath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "PAIRS.jsonl",
    );
    const completePrefix = await readFile(pairsPath, "utf8");
    await appendFile(pairsPath, `{"pair_id":"${PAIR_ID}"`, "utf8");

    await expect(loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    })).resolves.toMatchObject({
      pairs: [expect.objectContaining({ pairId: PAIR_ID, status: "pending" })],
    });
    await appendAssistantResponse({
      assistantResponse: "The journal recovered.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });

    await expect(loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    })).resolves.toMatchObject({
      pairs: [expect.objectContaining({ pairId: PAIR_ID, status: "completed" })],
    });
    const repairedJsonl = await readFile(pairsPath, "utf8");
    expect(repairedJsonl.endsWith("\n")).toBe(true);
    expect(repairedJsonl.startsWith(completePrefix)).toBe(true);
    expect(repairedJsonl.trim().split("\n").map((line) => JSON.parse(line))).toHaveLength(2);
  });

  it("rejects interior corruption in pair revision history", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-pairs-corrupt-row-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const pairsPath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "PAIRS.jsonl",
    );
    const validRow = await readFile(pairsPath, "utf8");
    await appendFile(pairsPath, `not-json\n${validRow}`, "utf8");

    await expect(loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    })).rejects.toThrow(SyntaxError);
  });

  it("keeps Codex app-server ids out of durable thread manifests and turn records", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-codex-thread-id-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    await markPsychiatristTurnCompleted({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect("codexThreadId" in loaded.manifest).toBe(false);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.json"),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.not.toHaveProperty("codex_thread_id");
    const turnRecord = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
      "utf8",
    ).then((content) => JSON.parse(content));
    expect(turnRecord).not.toHaveProperty("codex_thread_id");
    expect(turnRecord).not.toHaveProperty("codex_turn_id");
  });

  it("removes first-answer response artifacts when completed revision append fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-first-answer-append-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const pairRevisionLogPath = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl");
    await chmod(pairRevisionLogPath, 0o444);

    try {
      await expect(
        appendAssistantResponse({
          assistantResponse: "Uncommitted first answer.",
          citations: [],
          config: { storePath },
          pairId: PAIR_ID,
          threadId: THREAD_ID,
        }),
      ).rejects.toThrow();
    } finally {
      await chmod(pairRevisionLogPath, 0o644);
    }

    const responsePath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "RESPONSE.md",
    );
    await expect(readFile(responsePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const rows = await readFile(pairRevisionLogPath, "utf8").then((content) =>
      content.trim().split("\n").map((line) => JSON.parse(line)),
    );
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending"]);
    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "pending",
        turnId: TURN_ID,
      }),
    ]);
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
  });

  it("removes retried first-answer response artifacts when completed revision append fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-retry-answer-append-fail-"));
    const retryTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "Needs current sources?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await markPsychiatristTurnFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "network_permission_required",
        message: "Web sources need approval.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const pairRevisionLogPath = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl");
    await chmod(pairRevisionLogPath, 0o444);

    try {
      await expect(
        appendRetriedAssistantResponse({
          assistantResponse: "Uncommitted approved answer.",
          citations: [],
          config: { storePath },
          pairId: PAIR_ID,
          threadId: THREAD_ID,
          turnId: retryTurnId,
        }),
      ).rejects.toThrow();
    } finally {
      await chmod(pairRevisionLogPath, 0o644);
    }

    const responsePath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "RESPONSE.md",
    );
    await expect(readFile(responsePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const rows = await readFile(pairRevisionLogPath, "utf8").then((content) =>
      content.trim().split("\n").map((line) => JSON.parse(line)),
    );
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "failed"]);
    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        pairId: PAIR_ID,
        status: "failed",
      }),
    ]);
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
  });

  it("does not hide a saved assistant answer when a later turn finalization fails", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-post-save-fail-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "The saved answer must remain visible.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });

    await markPsychiatristTurnFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "post_save_finalization_failed",
        message: "Finalization failed after the answer was saved.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({
          content: "The saved answer must remain visible.",
        }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: TURN_ID,
      }),
    ]);
    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed"]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md"),
        "utf8",
      ),
    ).resolves.toContain("The saved answer must remain visible.");
  });

  it("reports post-save warnings when THREAD.md rewrite fails after a completed pair append", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-post-save-rewrite-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const threadMarkdownPath = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md");
    await rm(threadMarkdownPath);
    await mkdir(threadMarkdownPath);

    await expect(appendAssistantResponse({
      assistantResponse: "The saved answer must not be failed.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    })).resolves.toEqual({
      status: "completed",
      warning: "post_save_finalization_failed",
    });

    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed"]);
    expect(rows[1]).toMatchObject({
      assistant_response: "The saved answer must not be failed.",
      status: "completed",
    });
  });

  it("does not overwrite completed turns when Stop arrives after completion", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-post-complete-stop-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Completed before Stop.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await markPsychiatristTurnCompleted({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    await markPsychiatristTurnCanceled({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({
          content: "Completed before Stop.",
        }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: TURN_ID,
      }),
    ]);
    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed"]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      completed_at: expect.any(String),
      status: "completed",
      turn_id: TURN_ID,
    });
  });

  it("does not overwrite failed turns when Stop arrives after failure", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-failed-stop-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "Needs current sources?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await markPsychiatristTurnFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "network_permission_required",
        message: "Web sources need approval.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    await expect(
      markPsychiatristTurnCanceled({
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      }),
    ).resolves.toBe("failed");

    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      safe_error: { code: "network_permission_required" },
      status: "failed",
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      retryAction: "allow_web_sources",
      status: "failed",
    });
  });

  it("does not overwrite failed turns when completion arrives late", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-failed-complete-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "Needs current sources?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await markPsychiatristTurnFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "network_permission_required",
        message: "Web sources need approval.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    await expect(
      markPsychiatristTurnCompleted({
        codexThreadId: "codex-thread-late",
        codexTurnId: "codex-turn-late",
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      }),
    ).resolves.toBe("failed");

    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      safe_error: { code: "network_permission_required" },
      status: "failed",
    });
  });

  it("reconciles abandoned approved first-answer retry turns without appending duplicate pair revisions", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-abandoned-answer-retry-"));
    const approvedRetryTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "Needs current sources?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await markPsychiatristTurnFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "network_permission_required",
        message: "Web sources need approval.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: approvedRetryTurnId,
    });

    await expect(
      reconcileInactivePsychiatristTurns({
        activeTurnIds: [],
        config: { storePath },
        threadId: THREAD_ID,
      }),
    ).resolves.toBe(true);

    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "failed"]);
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${approvedRetryTurnId}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      failed_at: expect.any(String),
      pair_id: PAIR_ID,
      safe_error: {
        action: "retry",
        code: "turn_interrupted",
        message: "Psychiatrist turn was interrupted before completion.",
      },
      status: "failed",
      turn_id: approvedRetryTurnId,
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      pairId: PAIR_ID,
      status: "failed",
    });
    expect(loaded.pairs[0]).not.toHaveProperty("retryAction");
    expect(loaded.pairs[0]).not.toHaveProperty("retryMode");
    expect(loaded.pairs[0]).not.toHaveProperty("retryTurnId");
  });

  it("repairs a completed first-answer revision after a crash before turn and replay finalization", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-completed-answer-recovery-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { pair_id: PAIR_ID, status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
        type: "psychiatrist.turn.started",
      },
    });
    await appendAssistantResponse({
      assistantResponse: "Recovered first answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await writeFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md"),
      "# stale projection\n",
      "utf8",
    );

    await expect(reconcileInactivePsychiatristTurns({
      activeTurnIds: [],
      config: { storePath },
      threadId: THREAD_ID,
    })).resolves.toBe(true);

    await expect(readTurn(storePath, TURN_ID)).resolves.toMatchObject({
      completed_at: expect.any(String),
      pair_id: PAIR_ID,
      status: "completed",
      turn_id: TURN_ID,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.turn.started",
      "psychiatrist.answer.completed",
    ]);
    expect(replay.at(-1)?.data).toMatchObject({
      pair_id: PAIR_ID,
      text: "Recovered first answer.",
    });
    await expect(loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID }))
      .resolves.toMatchObject({
        pairs: [expect.objectContaining({ status: "completed", turnId: TURN_ID })],
      });
    await expect(readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md"),
      "utf8",
    )).resolves.toContain("Recovered first answer.");
  });

  it("repairs a completed regenerate revision instead of marking its started turn failed", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-completed-regenerate-recovery-"));
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await markPsychiatristTurnCompleted({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId: PAIR_ID,
      regenerateFromTurnId: TURN_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    await appendPsychiatristStreamEvent({
      config: { storePath },
      event: {
        data: { pair_id: PAIR_ID, status: "running" },
        memoryId: MEMORY_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
        type: "psychiatrist.regenerate.started",
      },
    });
    await appendRegeneratedAssistantResponse({
      assistantResponse: "Recovered regenerated answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });

    await expect(reconcileInactivePsychiatristTurns({
      activeTurnIds: [],
      config: { storePath },
      threadId: THREAD_ID,
    })).resolves.toBe(true);

    await expect(readTurn(storePath, regenerateTurnId)).resolves.toMatchObject({
      completed_at: expect.any(String),
      pair_id: PAIR_ID,
      regenerate_from_turn_id: TURN_ID,
      status: "completed",
      turn_id: regenerateTurnId,
    });
    const replay = await loadPsychiatristStreamReplay({
      config: { storePath },
      memoryId: MEMORY_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    expect(replay.map((event) => event.type)).toEqual([
      "psychiatrist.regenerate.started",
      "psychiatrist.regenerate.completed",
    ]);
    expect(replay.at(-1)?.data).toMatchObject({
      pair_id: PAIR_ID,
      text: "Recovered regenerated answer.",
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Recovered regenerated answer." }),
      status: "completed",
      turnId: regenerateTurnId,
    });
  });

  it("does not overwrite canceled turns when completion arrives late", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-canceled-complete-metadata-"));
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "Stop this.",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await markPsychiatristTurnCanceled({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    await expect(
      markPsychiatristTurnCompleted({
        codexThreadId: "codex-thread-late",
        codexTurnId: "codex-turn-late",
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
        turnId: TURN_ID,
      }),
    ).resolves.toBe("canceled");

    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      safe_error: { code: "turn_stopped" },
      status: "canceled",
    });
  });

  it("rejects late assistant completions for canceled message turns", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-canceled-complete-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await markPsychiatristTurnCanceled({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });

    await expect(
      appendAssistantResponse({
        assistantResponse: "Late answer after Stop.",
        citations: [],
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
      }),
    ).rejects.toMatchObject({
      code: "turn_canceled",
      name: "PsychiatristThreadStoreError",
    } satisfies Partial<PsychiatristThreadStoreError>);
    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toHaveLength(1);
    expect(loaded.pairs[0]).toMatchObject({
      pairId: PAIR_ID,
      status: "canceled",
      turnId: TURN_ID,
    });
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "canceled"]);
  });

  it("rejects late regenerated completions for canceled regenerate turns", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-canceled-regenerate-"));
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await markPsychiatristTurnCanceled({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });

    await expect(
      appendRegeneratedAssistantResponse({
        assistantResponse: "Late regenerated answer.",
        citations: [],
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
      }),
    ).rejects.toMatchObject({
      code: "turn_canceled",
      name: "PsychiatristThreadStoreError",
    } satisfies Partial<PsychiatristThreadStoreError>);
    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({ content: "Original answer." }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: TURN_ID,
      }),
    ]);
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "pairs",
          PAIR_ID,
          "RESPONSE.md",
        ),
        "utf8",
      ),
    ).resolves.toBe("Original answer.");
  });

  it("restores the previous response when regenerate fails before recording the completed revision", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-append-fail-"));
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    const pairRevisionLogPath = join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl");
    await chmod(pairRevisionLogPath, 0o444);

    try {
      await expect(
        appendRegeneratedAssistantResponse({
          assistantResponse: "Uncommitted regenerated answer.",
          citations: [],
          config: { storePath },
          pairId: PAIR_ID,
          threadId: THREAD_ID,
          turnId: regenerateTurnId,
        }),
      ).rejects.toThrow();
    } finally {
      await chmod(pairRevisionLogPath, 0o644);
    }

    const responsePath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "RESPONSE.md",
    );
    await expect(readFile(responsePath, "utf8")).resolves.toBe("Original answer.");
    const rows = await readFile(pairRevisionLogPath, "utf8").then((content) =>
      content.trim().split("\n").map((line) => JSON.parse(line)),
    );
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed"]);
    expect(rows[1]).toMatchObject({
      assistant_response: "Original answer.",
      status: "completed",
      turn_id: TURN_ID,
    });
    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({ content: "Original answer." }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: TURN_ID,
      }),
    ]);
  });

  it("keeps the regenerated response when manifest update fails after recording the completed revision", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-regenerate-manifest-fail-"));
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    failNextThreadManifestUpdateForTests(async () => {
      throw new Error("Manifest update failed after pair row append.");
    });

    await expect(
      appendRegeneratedAssistantResponse({
        assistantResponse: "Recorded regenerated answer.",
        citations: [],
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
        turnId: regenerateTurnId,
      }),
    ).resolves.toEqual({
      status: "completed",
      warning: "post_save_finalization_failed",
    });

    const responsePath = join(
      storePath,
      "memories",
      MEMORY_ID,
      "threads",
      THREAD_ID,
      "pairs",
      PAIR_ID,
      "RESPONSE.md",
    );
    await expect(readFile(responsePath, "utf8")).resolves.toBe("Recorded regenerated answer.");
    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed", "completed"]);
    expect(rows[2]).toMatchObject({
      assistant_response: "Recorded regenerated answer.",
      regenerated_from_turn_id: TURN_ID,
      status: "completed",
      turn_id: regenerateTurnId,
    });
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.md"),
        "utf8",
      ),
    ).resolves.toContain("Recorded regenerated answer.");
  });

  it("does not overwrite canceled regenerate turns when failure arrives late", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-canceled-regenerate-fail-"));
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await markPsychiatristTurnCanceled({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });

    await markPsychiatristRegenerateFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "codex_failed",
        message: "Codex failed.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });

    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${regenerateTurnId}.json`),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      safe_error: { code: "turn_stopped" },
      status: "canceled",
    });
    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]?.assistant?.content).toBe("Original answer.");
  });

  it("does not rehydrate obsolete regenerate web-source retries after a later regenerate succeeds", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-obsolete-regenerate-retry-"));
    const deniedRegenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    const approvedRegenerateTurnId = "019e8a00-0000-7000-8000-000000000006";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await delay(5);
    await markPsychiatristRegenerateFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "network_permission_required",
        message: "Web sources need approval.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: deniedRegenerateTurnId,
    });

    await expect(loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID })).resolves.toMatchObject({
      pairs: [
        expect.objectContaining({
          assistant: expect.objectContaining({ content: "Original answer." }),
          retryAction: "allow_web_sources",
          retryMode: "regenerate",
          retryTurnId: deniedRegenerateTurnId,
          status: "completed",
          turnId: TURN_ID,
        }),
      ],
    });

    await appendRegeneratedAssistantResponse({
      assistantResponse: "Approved regenerated answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: approvedRegenerateTurnId,
      webSourcePolicy: { allowed: true, reason: "user_approved_for_turn" },
    });

    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Approved regenerated answer." }),
      status: "completed",
      turnId: approvedRegenerateTurnId,
    });
    expect(loaded.pairs[0]).not.toHaveProperty("retryAction");
    expect(loaded.pairs[0]).not.toHaveProperty("retryMode");
    expect(loaded.pairs[0]).not.toHaveProperty("retryTurnId");
  });

  it("does not rehydrate regenerate web-source retries after a later terminal regenerate fails differently", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-terminal-regenerate-retry-"));
    const deniedRegenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    const laterRegenerateTurnId = "019e8a00-0000-7000-8000-000000000006";
    await createPsychiatristThread({ config: { storePath }, manifest: manifest() });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Original answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await delay(5);
    await markPsychiatristRegenerateFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "network_permission_required",
        message: "Web sources need approval.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: deniedRegenerateTurnId,
    });

    await expect(loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID })).resolves.toMatchObject({
      pairs: [
        expect.objectContaining({
          retryAction: "allow_web_sources",
          retryMode: "regenerate",
          retryTurnId: deniedRegenerateTurnId,
        }),
      ],
    });

    await delay(5);
    await markPsychiatristRegenerateFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "app_server_unavailable",
        message: "Codex app-server is unavailable.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: laterRegenerateTurnId,
    });

    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs[0]).toMatchObject({
      assistant: expect.objectContaining({ content: "Original answer." }),
      status: "completed",
      turnId: TURN_ID,
    });
    expect(loaded.pairs[0]).not.toHaveProperty("retryAction");
    expect(loaded.pairs[0]).not.toHaveProperty("retryMode");
    expect(loaded.pairs[0]).not.toHaveProperty("retryTurnId");
  });

  it("rejects assistant responses without a matching pending pair", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-orphan-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });

    await expect(
      appendAssistantResponse({
        assistantResponse: "Orphan answer.",
        citations: [],
        config: { storePath },
        pairId: PAIR_ID,
        threadId: THREAD_ID,
      }),
    ).rejects.toMatchObject({
      code: "pair_not_found",
      name: "PsychiatristThreadStoreError",
    } satisfies Partial<PsychiatristThreadStoreError>);
  });

  it("marks a thread stale without changing its stored content hash", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-stale-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });

    await markPsychiatristThreadStale({
      config: { storePath },
      threadId: THREAD_ID,
    });

    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.manifest).toMatchObject({
      activeContentHash: "sha256:source",
      status: "stale",
      threadId: THREAD_ID,
    });
    const manifestJson = JSON.parse(
      await readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.json"),
        "utf8",
      ),
    );
    expect(manifestJson).toMatchObject({
      active_content_hash: "sha256:source",
      status: "stale",
      thread_id: THREAD_ID,
    });
  });

  it("marks orphaned non-terminal regenerate turns interrupted without changing completed pair revisions", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-reconcile-regenerate-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await appendPendingPair({
      config: { storePath },
      contextSnapshot: contextSnapshot(),
      pairId: PAIR_ID,
      prompt: "What is the risk?",
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendAssistantResponse({
      assistantResponse: "Completed before restart.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
    });
    await markPsychiatristTurnCompleted({
      codexThreadId: "codex-thread-1",
      codexTurnId: "codex-turn-1",
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    const regenerateTurnId = "019e8a00-0000-7000-8000-000000000005";
    await appendRegeneratedAssistantResponse({
      assistantResponse: "Completed regenerated answer.",
      citations: [],
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    await markPsychiatristTurnCompleted({
      codexThreadId: "codex-thread-2",
      codexTurnId: "codex-turn-2",
      config: { storePath },
      pairId: PAIR_ID,
      regenerateFromTurnId: TURN_ID,
      threadId: THREAD_ID,
      turnId: regenerateTurnId,
    });
    const abandonedChainedRegenerateTurnId = "019e8a00-0000-7000-8000-000000000006";
    await recordPsychiatristTurnStarted({
      config: { storePath },
      pairId: PAIR_ID,
      regenerateFromTurnId: regenerateTurnId,
      threadId: THREAD_ID,
      turnId: abandonedChainedRegenerateTurnId,
    });

    await expect(
      reconcileInactivePsychiatristTurns({
        activeTurnIds: [],
        config: { storePath },
        threadId: THREAD_ID,
      }),
    ).resolves.toBe(true);

    const loaded = await loadPsychiatristThread({ config: { storePath }, threadId: THREAD_ID });
    expect(loaded.pairs).toEqual([
      expect.objectContaining({
        assistant: expect.objectContaining({
          content: "Completed regenerated answer.",
        }),
        pairId: PAIR_ID,
        status: "completed",
        turnId: regenerateTurnId,
      }),
    ]);
    const rows = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "PAIRS.jsonl"),
      "utf8",
    ).then((content) => content.trim().split("\n").map((line) => JSON.parse(line)));
    expect(rows.map((row) => row.revision_kind)).toEqual(["pending", "completed", "completed"]);
    await expect(
      readFile(
        join(
          storePath,
          "memories",
          MEMORY_ID,
          "threads",
          THREAD_ID,
          "turns",
          `${abandonedChainedRegenerateTurnId}.json`,
        ),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      failed_at: expect.any(String),
      pair_id: PAIR_ID,
      regenerate_from_turn_id: regenerateTurnId,
      safe_error: {
        action: "retry",
        code: "turn_interrupted",
        message: "Psychiatrist turn was interrupted before completion.",
      },
      status: "failed",
      turn_id: abandonedChainedRegenerateTurnId,
    });
  });

  it("finds the latest ready thread matching the exact source reader variant", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-latest-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        createdAt: "2026-06-01T00:00:00.000Z",
        threadId: THREAD_ID,
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
    });
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        createdAt: "2026-06-01T00:00:01.000Z",
        threadId: THREAD_ID_2,
        updatedAt: "2026-06-01T00:00:01.000Z",
      }),
    });

    await expect(findLatestPsychiatristThread({
      activeContentHash: "sha256:source",
      config: { storePath },
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      sourceHash: "sha256:source",
      variantKind: "source",
    })).resolves.toMatchObject({
      manifest: expect.objectContaining({
        threadId: THREAD_ID_2,
      }),
      pairs: [],
    });
  });

  it("resumes translated threads only for the exact language and output hash", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-latest-translation-"));
    const frenchThreadId = "019e8a00-0000-7000-8000-000000000007";
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest(),
    });
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        activeContentHash: "sha256:translated-ja",
        langCode: "ja-JP",
        threadId: THREAD_ID_2,
        translationOutputHash: "sha256:translated-ja",
        variantKind: "translation",
      }),
    });
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        activeContentHash: "sha256:translated-fr",
        langCode: "fr-FR",
        threadId: frenchThreadId,
        translationOutputHash: "sha256:translated-fr",
        variantKind: "translation",
      }),
    });

    await expect(findLatestPsychiatristThread({
      activeContentHash: "sha256:translated-ja",
      config: { storePath },
      langCode: "ja-JP",
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      sourceHash: "sha256:source",
      translationOutputHash: "sha256:translated-ja",
      variantKind: "translation",
    })).resolves.toMatchObject({ manifest: expect.objectContaining({ threadId: THREAD_ID_2 }) });
    await expect(findLatestPsychiatristThread({
      activeContentHash: "sha256:translated-fr",
      config: { storePath },
      langCode: "fr-FR",
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      sourceHash: "sha256:source",
      translationOutputHash: "sha256:translated-fr",
      variantKind: "translation",
    })).resolves.toMatchObject({ manifest: expect.objectContaining({ threadId: frenchThreadId }) });
    await expect(findLatestPsychiatristThread({
      activeContentHash: "sha256:translated-ja-new",
      config: { storePath },
      langCode: "ja-JP",
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      sourceHash: "sha256:source",
      translationOutputHash: "sha256:translated-ja-new",
      variantKind: "translation",
    })).resolves.toBeUndefined();
  });

  it("does not reuse latest threads from an older prompt policy version", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-latest-policy-"));
    await createPsychiatristThread({
      config: { storePath },
      manifest: manifest({
        policyVersion: "psychiatrist-memory-pairs-old",
        threadId: THREAD_ID,
      }),
    });

    await expect(findLatestPsychiatristThread({
      activeContentHash: "sha256:source",
      config: { storePath },
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      sourceHash: "sha256:source",
      variantKind: "source",
    })).resolves.toBeUndefined();
  });
});

function manifest(
  input: Partial<PsychiatristThreadManifest> = {},
): PsychiatristThreadManifest {
  return {
    activeContentHash: "sha256:source",
    createdAt: "2026-06-01T00:00:00.000Z",
    memoryId: MEMORY_ID,
    policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
    sourceHash: "sha256:source",
    status: "ready",
    threadId: THREAD_ID,
    updatedAt: "2026-06-01T00:00:00.000Z",
    variantKind: "source",
    ...input,
  };
}

function contextSnapshot(): PsychiatristContextSnapshotManifest {
  return {
    categories: [],
    contentHash: "sha256:source",
    contextSnapshotId: "snapshot-1",
    memoryId: MEMORY_ID,
    policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
    relativePath: `memories/${MEMORY_ID}/CONTENT.md`,
    selectedSectionAnchors: ["risk"],
    selectedSectionHashes: ["sha256:section"],
    sections: [
      {
        anchor: "risk",
        endOffset: 18,
        level: 2,
        markdown: "## Risk\n\nNo rollback.",
        path: "1",
        startOffset: 0,
        title: "Risk",
      },
    ],
    sourceUrl: "https://example.com/memory",
    tags: [],
    title: "Memory",
    userPrompt: "What is the risk?",
    variantKind: "source",
  };
}

async function readTurn(storePath: string, turnId: string): Promise<unknown> {
  return JSON.parse(await readFile(
    join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${turnId}.json`),
    "utf8",
  ));
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
