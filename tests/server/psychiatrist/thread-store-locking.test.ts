import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  appendPendingPair,
  createPsychiatristThread,
  loadPsychiatristThread,
  markPsychiatristTurnCanceled,
  markPsychiatristTurnFailed,
} from "../../../src/server/psychiatrist/thread-store";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
import type {
  PsychiatristContextSnapshotManifest,
  PsychiatristThreadManifest,
} from "../../../src/server/psychiatrist/types";

const appendGate = vi.hoisted(() => ({
  enabled: false,
  hit: undefined as Promise<void> | undefined,
  release: undefined as Promise<void> | undefined,
  resolveHit: undefined as (() => void) | undefined,
  resolveRelease: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      if (
        appendGate.enabled &&
        String(args[1]).includes('"revision_kind":"failed"')
      ) {
        appendGate.enabled = false;
        appendGate.resolveHit?.();
        await appendGate.release;
      }
      return actual.appendFile(...args);
    },
  };
});

const MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001";
const THREAD_ID = "019e8a00-0000-7000-8000-000000000001";
const PAIR_ID = "019e8a00-0000-7000-8000-000000000002";
const TURN_ID = "019e8a00-0000-7000-8000-000000000003";

describe("Psychiatrist thread store mutation locking", () => {
  it("keeps the first terminal state when failure races with cancellation", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-psychiatrist-fail-stop-race-"));
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
    armFailedAppendGate();

    const failPromise = markPsychiatristTurnFailed({
      config: { storePath },
      error: {
        action: "retry",
        code: "codex_failed",
        message: "Codex failed.",
      },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await appendGate.hit;

    const cancelPromise = markPsychiatristTurnCanceled({
      config: { storePath },
      pairId: PAIR_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    appendGate.resolveRelease?.();

    await Promise.all([failPromise, cancelPromise]);

    const loaded = await loadPsychiatristThread({
      config: { storePath },
      threadId: THREAD_ID,
    });
    expect(loaded.pairs[0]).toMatchObject({
      pairId: PAIR_ID,
      status: "failed",
      turnId: TURN_ID,
    });
    expect(loaded.pairs[0]?.assistant).toBeUndefined();
    const turnRecord = await readFile(
      join(storePath, "memories", MEMORY_ID, "threads", THREAD_ID, "turns", `${TURN_ID}.json`),
      "utf8",
    ).then((content) => JSON.parse(content));
    expect(turnRecord).toMatchObject({
      safe_error: {
        action: "retry",
        code: "codex_failed",
        message: "Codex failed.",
      },
      status: "failed",
      turn_id: TURN_ID,
    });
  });
});

function armFailedAppendGate(): void {
  appendGate.enabled = true;
  appendGate.hit = new Promise((resolve) => {
    appendGate.resolveHit = resolve;
  });
  appendGate.release = new Promise((resolve) => {
    appendGate.resolveRelease = resolve;
  });
}

function manifest(): PsychiatristThreadManifest {
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
