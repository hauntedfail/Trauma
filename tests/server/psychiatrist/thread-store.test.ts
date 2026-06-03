import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PsychiatristThreadStoreError,
  appendAssistantResponse,
  appendPendingPair,
  createPsychiatristThread,
  findLatestPsychiatristThread,
  loadPsychiatristThread,
  markPsychiatristThreadStale,
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
      variantKind: "source",
    })).resolves.toMatchObject({
      manifest: expect.objectContaining({
        threadId: THREAD_ID_2,
      }),
      pairs: [],
    });
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
    contentHash: "sha256:source",
    contextSnapshotId: "snapshot-1",
    memoryId: MEMORY_ID,
    policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
    selectedSectionAnchors: ["risk"],
    selectedSectionHashes: ["sha256:section"],
    userPrompt: "What is the risk?",
    variantKind: "source",
  };
}
