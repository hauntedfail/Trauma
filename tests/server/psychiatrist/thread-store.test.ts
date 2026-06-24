import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PsychiatristThreadStoreError,
  appendAssistantResponse,
  appendPendingPair,
  appendRegeneratedAssistantResponse,
  createPsychiatristThread,
  findLatestPsychiatristThread,
  loadPsychiatristThread,
  markPsychiatristRegenerateFailed,
  markPsychiatristTurnCanceled,
  markPsychiatristTurnCompleted,
  markPsychiatristTurnFailed,
  markPsychiatristThreadStale,
  reconcileInactivePsychiatristTurns,
  recordPsychiatristTurnStarted,
} from "../../../src/server/psychiatrist/thread-store";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
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

  it("persists Codex thread ids on the thread manifest when turns complete", async () => {
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
    expect(loaded.manifest.codexThreadId).toBe("codex-thread-1");
    await expect(
      readFile(
        join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "THREAD.json"),
        "utf8",
      ).then((content) => JSON.parse(content)),
    ).resolves.toMatchObject({
      codex_thread_id: "codex-thread-1",
    });
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

  it("finds the latest ready thread matching memory variant and content hash", async () => {
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
      langCode: undefined,
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      variantKind: "source",
    })).resolves.toMatchObject({
      manifest: expect.objectContaining({
        threadId: THREAD_ID_2,
      }),
      pairs: [],
    });
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
      langCode: undefined,
      memoryId: MEMORY_ID,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
