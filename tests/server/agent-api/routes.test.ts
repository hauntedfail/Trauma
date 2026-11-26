import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as GET_AGENT_CONTEXT } from "../../../src/routes/api/agent/v1/context";
import { GET as GET_AGENT_MEMORY } from "../../../src/routes/api/agent/v1/memories/[memoryId]";
import { POST as POST_AGENT_TRIAGE } from "../../../src/routes/api/agent/v1/memories/[memoryId]/triage";
import { POST as POST_AGENT_ASK } from "../../../src/routes/api/agent/v1/memories/[memoryId]/ask";
import { createAgentAskHandler } from "../../../src/server/agent-api/ask-route";
import type {
  AgentAskResponse,
  AgentContextResponse,
  AgentMemoryReadingStateResponse,
  AgentTriageResponse,
} from "../../../src/server/agent-api/types";
import { initializeDatabase } from "../../../src/server/db";
import { TRAUMA_API_TOKEN_ENV_VAR } from "../../../src/server/http/api-auth";
import { activePsychiatristTurns } from "../../../src/server/psychiatrist/active-turns";
import { handleSendPsychiatristMessageRequest } from "../../../src/server/psychiatrist/message-route";
import { handleStartPsychiatristThreadRequest } from "../../../src/server/psychiatrist/thread-route";
import { ensureRuntimeProcessLease } from "../../../src/server/runtime/process-lease";
import {
  createMemoryContentFixture,
  writeMemoryContent,
} from "../../../src/server/store/memory-content";
import type {
  CodexConversationClient,
  CodexConversationTurnInput,
  CodexConversationTurnResult,
} from "../../../src/server/translation/codex-app-server";
import { createSha256ContentHash } from "../../../src/server/translation/hash";
import { resolveTranslatedMemoryContentPath } from "../../../src/server/translation/paths";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../../src/server/translation/prompt";
import { loadTranslationSourceSnapshot } from "../../../src/server/translation/source-loader";
import {
  createApiEvent,
  loadRouteConfig,
  writeRouteConfig,
} from "../routes/api-test-helpers";

const tempDirs: string[] = [];
const leaseDisposers: Array<() => void> = [];
const originalConfigPath = process.env.TRAUMA_CONFIG_PATH;
const originalApiToken = process.env[TRAUMA_API_TOKEN_ENV_VAR];

const MEMORY_TODAY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f701";
const MEMORY_SHELF_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f702";
const MEMORY_LIBRARY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f703";
const MEMORY_ARCHIVE_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f704";
const MEMORY_NO_WORD_COUNT_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f705";
const MISSING_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f799";

const SAMPLE_SOURCE_MARKDOWN = [
  "# Attention Architecture",
  "",
  "Opening summary for the article.",
  "",
  "## In-Situ Assistance",
  "",
  "Selection-anchored margin notes keep reading flow intact.",
].join("\n");

const SAMPLE_JA_MARKDOWN = [
  "# 注意アーキテクチャ",
  "",
  "記事の導入要約です。",
  "",
  "## インサイチュ支援",
  "",
  "選択範囲に紐づく余白ノートは読書の流れを保ちます。",
].join("\n");

afterEach(async () => {
  activePsychiatristTurns.clear();
  for (const dispose of leaseDisposers.splice(0)) {
    dispose();
  }
  if (originalConfigPath === undefined) {
    delete process.env.TRAUMA_CONFIG_PATH;
  } else {
    process.env.TRAUMA_CONFIG_PATH = originalConfigPath;
  }
  if (originalApiToken === undefined) {
    delete process.env[TRAUMA_API_TOKEN_ENV_VAR];
  } else {
    process.env[TRAUMA_API_TOKEN_ENV_VAR] = originalApiToken;
  }

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function setupWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "trauma-agent-api-"));
  tempDirs.push(root);
  const configPath = await writeRouteConfig(root);
  process.env.TRAUMA_CONFIG_PATH = configPath;
  const config = loadRouteConfig(configPath);
  const connection = initializeDatabase(config);

  const t1 = new Date("2026-06-01T08:00:00.000Z");
  const t2 = new Date("2026-06-02T08:00:00.000Z");
  const t3 = new Date("2026-06-03T08:00:00.000Z");
  const t4 = new Date("2026-06-04T08:00:00.000Z");

  try {
    await connection.repositories.memories.create({
      id: MEMORY_TODAY_ID,
      url: "https://www.example.com/posts/attention-architecture",
      title: "Attention Architecture",
      description: "Calm reading design",
      faviconUrl: "https://www.example.com/favicon.ico",
      contentPath: `memories/${MEMORY_TODAY_ID}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      triageState: "today",
      triageChangedAt: t2,
      lastPosition: JSON.stringify({
        variant: "source",
        headingId: "in-situ-assistance",
        paragraphIndex: 3,
        scrollRatio: 0.45,
        updatedAt: "2026-06-05T10:00:00.000Z",
      }),
      lastOpenedAt: new Date("2026-06-05T10:00:00.000Z"),
      wordCount: 920,
      createdAt: t1,
      updatedAt: t2,
    });

    await connection.repositories.memories.create({
      id: MEMORY_SHELF_ID,
      url: "https://research.org/papers/gaze-to-context",
      title: "Gaze-to-Context",
      description: "Automatic passage grounding",
      faviconUrl: null,
      contentPath: `memories/${MEMORY_SHELF_ID}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      triageState: "shelf",
      triageChangedAt: t2,
      wordCount: 320,
      createdAt: t2,
      updatedAt: t2,
    });

    await connection.repositories.memories.create({
      id: MEMORY_LIBRARY_ID,
      url: "https://library.example/long-essay",
      title: "Long Essay",
      description: "Archived knowledge",
      faviconUrl: null,
      contentPath: `memories/${MEMORY_LIBRARY_ID}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      read: true,
      triageState: "library",
      triageChangedAt: t3,
      lastOpenedAt: new Date("2026-06-04T09:00:00.000Z"),
      wordCount: 2400,
      createdAt: t3,
      updatedAt: t3,
    });

    // Archived memory with an even newer lastOpenedAt — should NOT be surfaced as activeMemory
    await connection.repositories.memories.create({
      id: MEMORY_ARCHIVE_ID,
      url: "https://archive.example/dismissed",
      title: "Dismissed Item",
      description: null,
      faviconUrl: null,
      contentPath: `memories/${MEMORY_ARCHIVE_ID}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      triageState: "archive",
      triageChangedAt: t4,
      lastOpenedAt: new Date("2026-06-06T12:00:00.000Z"),
      wordCount: 400,
      createdAt: t4,
      updatedAt: t4,
    });

    await writeMemoryContent({
      config: { storePath: config.storePath },
      memoryId: MEMORY_TODAY_ID,
      overwrite: true,
      frontmatter: {
        id: MEMORY_TODAY_ID,
        url: "https://www.example.com/posts/attention-architecture",
        title: "Attention Architecture",
        capturedAt: t1.toISOString(),
        extractionStatus: "success",
      },
      markdown: SAMPLE_SOURCE_MARKDOWN,
    });

    const sourceSnapshot = await loadTranslationSourceSnapshot({
      config: { storePath: config.storePath },
      memoryId: MEMORY_TODAY_ID,
    });
    const sourceHash = sourceSnapshot.sourceHash;
    const jaPath = resolveTranslatedMemoryContentPath({
      config: { storePath: config.storePath },
      memoryId: MEMORY_TODAY_ID,
      langCode: "ja-JP",
    });

    const jaFileContent = createMemoryContentFixture({
      frontmatter: {
        id: MEMORY_TODAY_ID,
        url: "https://www.example.com/posts/attention-architecture",
        title: "Attention Architecture",
        capturedAt: t1.toISOString(),
        extractionStatus: "success",
      },
      markdown: SAMPLE_JA_MARKDOWN,
    });
    await mkdir(dirname(jaPath.absolutePath), { recursive: true });
    await writeFile(jaPath.absolutePath, jaFileContent, "utf8");
    const jaOutputHash = createSha256ContentHash(Buffer.from(jaFileContent, "utf8"));

    const translationJobId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f801";
    await connection.repositories.translations.createTranslationJob({
      jobId: translationJobId,
      memoryId: MEMORY_TODAY_ID,
      langCode: "ja-JP",
      sourceHash,
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
      chunkerVersion: BRILLIANT_CHUNKER_VERSION,
      chunkCount: 1,
      now: t2,
    });
    await connection.repositories.translations.updateTranslationJobStatus(
      translationJobId,
      "complete",
      {
        outputPath: jaPath.relativePath,
        outputHash: jaOutputHash,
        completedAt: t2,
        updatedAt: t2,
      },
    );

    await connection.repositories.flashbacks.replaceForMemory(MEMORY_TODAY_ID, [
      {
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f811",
        memoryId: MEMORY_TODAY_ID,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
        text: "Selection-anchored margin notes",
        prefix: "## In-Situ Assistance\n\n",
        suffix: " keep reading flow intact.",
        startOffset: SAMPLE_SOURCE_MARKDOWN.indexOf(
          "Selection-anchored margin notes",
        ),
        endOffset:
          SAMPLE_SOURCE_MARKDOWN.indexOf("Selection-anchored margin notes") +
          "Selection-anchored margin notes".length,
        contentHash: null,
        createdAt: t2,
        updatedAt: t2,
      },
    ]);

    await connection.repositories.moments.create({
      id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f821",
      memoryId: MEMORY_TODAY_ID,
      sectionAnchor: "in-situ-assistance",
      sectionTitle: "In-Situ Assistance",
      sectionLevel: 2,
      sectionPath: "1.1",
      sectionStartOffset: 0,
      sectionEndOffset: 100,
      contentHash: sourceHash,
      createdAt: t2,
      updatedAt: t2,
    });
  } finally {
    connection.close();
  }

  return { config, configPath, root };
}

class FakePsychiatristClient implements CodexConversationClient {
  public readonly capturedPrompts: string[] = [];

  async probe(): Promise<void> {}

  async cancelTurn(): Promise<void> {}

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    this.capturedPrompts.push(input.input);
    await input.onEvent?.({
      type: "delta",
      text: "Grounded explanation response.",
    });
    return {
      outputText: "Grounded explanation response.",
      sourceCitations: [],
      threadId: input.threadId ?? "codex-thread-1",
      turnId: "codex-turn-1",
    };
  }
}

// The ask endpoint answers 202 and finishes the turn in a detached task that
// borrows the runtime lease. A test that ends while that task is still running
// leaves the lease release pending, and the next test then fails in
// setupWorkspace. Wait for the turn itself; a fixed delay loses under load.
async function waitForDetachedTurnToFinish(turnId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (activePsychiatristTurns.getByTurnId(turnId) !== undefined) {
    if (Date.now() > deadline) {
      throw new Error(`Psychiatrist turn ${turnId} did not finish in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  // The task returns its lease borrow in the microtasks that follow
  // unregistration. One macrotask boundary lets them run.
  await new Promise((resolve) => setImmediate(resolve));
}

describe("Headless Agent API (/api/agent/v1/*)", () => {
  describe("GET /api/agent/v1/context", () => {
    it("returns today, shelf, and activeMemory without unread-debt framing", async () => {
      await setupWorkspace();

      const response = await GET_AGENT_CONTEXT(
        createApiEvent(new Request("http://localhost/api/agent/v1/context")),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as AgentContextResponse &
        Record<string, unknown>;

      expect(Object.keys(body).sort()).toEqual([
        "activeMemory",
        "shelf",
        "today",
      ]);

      expect(body.today).toEqual([
        {
          id: MEMORY_TODAY_ID,
          title: "Attention Architecture",
          domain: "example.com",
          lengthBucket: "medium",
          lastPosition: {
            variant: "source",
            headingId: "in-situ-assistance",
            paragraphIndex: 3,
            scrollRatio: 0.45,
            updatedAt: "2026-06-05T10:00:00.000Z",
          },
          triageState: "today",
        },
      ]);

      expect(body.shelf).toEqual([
        {
          id: MEMORY_SHELF_ID,
          title: "Gaze-to-Context",
          domain: "research.org",
          lengthBucket: "short",
          lastPosition: null,
          triageState: "shelf",
        },
      ]);

      // Most recently opened non-archived memory is MEMORY_TODAY_ID
      expect(body.activeMemory).toEqual({
        id: MEMORY_TODAY_ID,
        title: "Attention Architecture",
        domain: "example.com",
        lengthBucket: "medium",
        lastPosition: {
          variant: "source",
          headingId: "in-situ-assistance",
          paragraphIndex: 3,
          scrollRatio: 0.45,
          updatedAt: "2026-06-05T10:00:00.000Z",
        },
        triageState: "today",
        lastOpenedAt: "2026-06-05T10:00:00.000Z",
        read: false,
      });

      // Verify no unread-debt framing keys exist
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(
        /unreadCount|totalUnread|remainingCount|backlog|waitingCount|overdue/i,
      );
    });

    it("enforces TRAUMA_API_TOKEN bearer auth and validates shelfLimit", async () => {
      await setupWorkspace();
      process.env[TRAUMA_API_TOKEN_ENV_VAR] = "agent-secret";

      const unauthorized = await GET_AGENT_CONTEXT(
        createApiEvent(
          new Request("http://localhost/api/agent/v1/context", {
            headers: { authorization: "Bearer wrong-token" },
          }),
        ),
      );
      expect(unauthorized.status).toBe(401);

      const invalidLimit = await GET_AGENT_CONTEXT(
        createApiEvent(
          new Request("http://localhost/api/agent/v1/context?shelfLimit=0", {
            headers: { authorization: "Bearer agent-secret" },
          }),
        ),
      );
      expect(invalidLimit.status).toBe(400);

      const authorized = await GET_AGENT_CONTEXT(
        createApiEvent(
          new Request("http://localhost/api/agent/v1/context?shelfLimit=1", {
            headers: { authorization: "Bearer agent-secret" },
          }),
        ),
      );
      expect(authorized.status).toBe(200);
    });
  });

  describe("GET /api/agent/v1/memories/[memoryId]", () => {
    it("returns full canonical reading state for source variant", async () => {
      await setupWorkspace();

      const response = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}`,
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as AgentMemoryReadingStateResponse;

      expect(body.id).toBe(MEMORY_TODAY_ID);
      expect(body.domain).toBe("example.com");
      expect(body.title).toBe("Attention Architecture");
      expect(body.triageState).toBe("today");
      expect(body.read).toBe(false);
      expect(body.lengthBucket).toBe("medium");
      expect(body.lastPosition?.headingId).toBe("in-situ-assistance");
      expect(body.activeVariant).toEqual({
        kind: "source",
        langCode: null,
        relativePath: `memories/${MEMORY_TODAY_ID}/CONTENT.md`,
      });
      expect(body.variants.map((variant) => variant.kind)).toEqual([
        "source",
        "translation",
      ]);
      expect(body.markdown).toBe(SAMPLE_SOURCE_MARKDOWN);
      expect(body.toc.map((entry) => entry.id)).toEqual([
        "attention-architecture",
        "in-situ-assistance",
      ]);
      expect(body.flashbacks).toHaveLength(1);
      expect(body.flashbacks[0]?.text).toBe("Selection-anchored margin notes");
      expect(body.moments).toHaveLength(1);
      expect(body.moments[0]?.sectionAnchor).toBe("in-situ-assistance");
    });

    it("returns translated markdown and activeVariant when ?lang=ja-JP is requested", async () => {
      await setupWorkspace();

      const response = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}?lang=ja-JP`,
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as AgentMemoryReadingStateResponse;
      expect(body.activeVariant).toEqual({
        kind: "translation",
        langCode: "ja-JP",
        relativePath: `memories/${MEMORY_TODAY_ID}/ja-JP/CONTENT.md`,
      });
      expect(body.markdown).toBe(SAMPLE_JA_MARKDOWN);
      expect(body.variants.find((v) => v.langCode === "ja-JP")?.active).toBe(true);
    });

    it("returns 400 for unsupported lang, 404 for missing memory/translation, and 401 on invalid token", async () => {
      await setupWorkspace();
      process.env[TRAUMA_API_TOKEN_ENV_VAR] = "agent-secret";

      const unauthorized = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}`,
            { headers: { authorization: "Bearer bad" } },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(unauthorized.status).toBe(401);

      const badLang = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}?lang=xx`,
            { headers: { authorization: "Bearer agent-secret" } },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(badLang.status).toBe(400);

      const missingMemory = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MISSING_MEMORY_ID}`,
            { headers: { authorization: "Bearer agent-secret" } },
          ),
          { memoryId: MISSING_MEMORY_ID },
        ),
      );
      expect(missingMemory.status).toBe(404);

      const missingTranslation = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}?lang=fr-FR`,
            { headers: { authorization: "Bearer agent-secret" } },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(missingTranslation.status).toBe(404);
    });
  });

  describe("POST /api/agent/v1/memories/[memoryId]/triage", () => {
    it("delegates to canonical triage service and returns 409 when Today cap is exceeded", async () => {
      await setupWorkspace();

      // MEMORY_TODAY_ID is already in today (count = 1). Trying to move MEMORY_SHELF_ID with todayCap = 1 -> 409.
      const capped = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ triageState: "today", todayCap: 1 }),
            },
          ),
          { memoryId: MEMORY_SHELF_ID },
        ),
      );
      expect(capped.status).toBe(409);
      expect(await capped.json()).toMatchObject({
        code: "today_cap_reached",
        todayCount: 1,
        todayCap: 1,
      });

      // Moving MEMORY_SHELF_ID to library succeeds
      const moved = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ triageState: "library" }),
            },
          ),
          { memoryId: MEMORY_SHELF_ID },
        ),
      );
      expect(moved.status).toBe(200);
      const movedBody = (await moved.json()) as AgentTriageResponse;
      expect(movedBody).toMatchObject({
        memoryId: MEMORY_SHELF_ID,
        triageState: "library",
        changed: true,
      });
    });

    it("enforces auth, CSRF origin checks, and payload validation", async () => {
      await setupWorkspace();
      process.env[TRAUMA_API_TOKEN_ENV_VAR] = "agent-secret";

      const unauthorized = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer wrong",
                "content-type": "application/json",
              },
              body: JSON.stringify({ triageState: "archive" }),
            },
          ),
          { memoryId: MEMORY_SHELF_ID },
        ),
      );
      expect(unauthorized.status).toBe(401);

      const crossOrigin = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
            {
              method: "POST",
              headers: {
                origin: "https://evil.example",
                "content-type": "application/json",
              },
              body: JSON.stringify({ triageState: "archive" }),
            },
          ),
          { memoryId: MEMORY_SHELF_ID },
        ),
      );
      expect(crossOrigin.status).toBe(403);

      const invalidState = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer agent-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({ triageState: "invalid_lane" }),
            },
          ),
          { memoryId: MEMORY_SHELF_ID },
        ),
      );
      expect(invalidState.status).toBe(400);

      const missing = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MISSING_MEMORY_ID}/triage`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer agent-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({ triageState: "archive" }),
            },
          ),
          { memoryId: MISSING_MEMORY_ID },
        ),
      );
      expect(missing.status).toBe(404);
    });
  });

  describe("POST /api/agent/v1/memories/[memoryId]/ask", () => {
    it("builds a passage-grounded prompt and delegates to Psychiatrist thread + message services", async () => {
      const { config } = await setupWorkspace();
      const lease = ensureRuntimeProcessLease(config);
      leaseDisposers.push(() => lease.release());

      const fakeClient = new FakePsychiatristClient();
      const handler = createAgentAskHandler({
        config,
        startThread: (forwarded) =>
          handleStartPsychiatristThreadRequest(forwarded, { config }),
        sendMessage: (forwarded) =>
          handleSendPsychiatristMessageRequest(forwarded, {
            config,
            client: fakeClient,
          }),
      });

      const response = await handler(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "explain",
                selectedText: "Selection-anchored margin notes",
                sectionAnchor: "in-situ-assistance",
              }),
            },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );

      expect(response.status).toBe(202);
      const body = (await response.json()) as AgentAskResponse;
      expect(body.threadId).toBeTruthy();
      expect(body.turnId).toBeTruthy();
      expect(body.pairId).toBeTruthy();
      expect(body.eventsUrl).toContain(
        `/api/memories/${MEMORY_TODAY_ID}/psychiatrist/threads/${body.threadId}/turns/${body.turnId}/events`,
      );
      expect(body.groundedContext).toEqual({
        action: "explain",
        memoryId: MEMORY_TODAY_ID,
        memoryTitle: "Attention Architecture",
        domain: "example.com",
        variantKind: "source",
        langCode: null,
        sectionAnchor: "in-situ-assistance",
        sectionTitle: "In-Situ Assistance",
        selectedText: "Selection-anchored margin notes",
        prompt: null,
      });

      await waitForDetachedTurnToFinish(body.turnId);
      expect(fakeClient.capturedPrompts).toHaveLength(1);
      expect(fakeClient.capturedPrompts[0]).toContain(
        "Section: In-Situ Assistance (#in-situ-assistance)",
      );
      expect(fakeClient.capturedPrompts[0]).toContain(
        "Selection-anchored margin notes",
      );
    });

    it("validates ask payload, auth, CSRF, and missing memory", async () => {
      await setupWorkspace();
      process.env[TRAUMA_API_TOKEN_ENV_VAR] = "agent-secret";

      // Invalid bearer token -> 401
      const unauthorized = await POST_AGENT_ASK(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer wrong",
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: "simplify" }),
            },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(unauthorized.status).toBe(401);

      // Cross-origin browser request -> 403
      const crossOrigin = await POST_AGENT_ASK(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
            {
              method: "POST",
              headers: {
                origin: "https://evil.example",
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: "simplify" }),
            },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(crossOrigin.status).toBe(403);

      // action="ask" without prompt -> 400
      const missingPrompt = await POST_AGENT_ASK(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer agent-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: "ask" }),
            },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(missingPrompt.status).toBe(400);

      // Unknown field -> 400
      const extraField = await POST_AGENT_ASK(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer agent-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: "simplify", unexpected: true }),
            },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(extraField.status).toBe(400);

      // Missing memory -> 404
      const missingMemory = await POST_AGENT_ASK(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MISSING_MEMORY_ID}/ask`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer agent-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: "simplify" }),
            },
          ),
          { memoryId: MISSING_MEMORY_ID },
        ),
      );
      expect(missingMemory.status).toBe(404);
    });
  });

  describe("Contract coverage (AC 16)", () => {
    it("returns documented JSON shape for /context and maps stored wordCount to lengthBucket or null when unset (AC 16)", async () => {
      const { config } = await setupWorkspace();
      const connection = initializeDatabase(config);
      const t5 = new Date("2026-06-05T08:00:00.000Z");
      try {
        await connection.repositories.memories.create({
          id: MEMORY_NO_WORD_COUNT_ID,
          url: "https://legacy.example/pre-migration-article",
          title: "Legacy Article Without Word Count",
          description: null,
          faviconUrl: null,
          contentPath: `memories/${MEMORY_NO_WORD_COUNT_ID}/CONTENT.md`,
          extractionStatus: "success",
          extractionError: null,
          backupStatus: "disabled",
          triageState: "shelf",
          triageChangedAt: t5,
          wordCount: null,
          createdAt: t5,
          updatedAt: t5,
        });
      } finally {
        connection.close();
      }

      const response = await GET_AGENT_CONTEXT(
        createApiEvent(new Request("http://localhost/api/agent/v1/context")),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as AgentContextResponse;

      expect(Object.keys(body).sort()).toEqual([
        "activeMemory",
        "shelf",
        "today",
      ]);

      const todayItem = body.today[0];
      expect(todayItem).toBeDefined();
      expect(Object.keys(todayItem ?? {}).sort()).toEqual([
        "domain",
        "id",
        "lastPosition",
        "lengthBucket",
        "title",
        "triageState",
      ]);
      expect(todayItem?.lengthBucket).toBe("medium");

      expect(body.activeMemory).not.toBeNull();
      expect(Object.keys(body.activeMemory ?? {}).sort()).toEqual([
        "domain",
        "id",
        "lastOpenedAt",
        "lastPosition",
        "lengthBucket",
        "read",
        "title",
        "triageState",
      ]);
      expect(body.activeMemory?.lengthBucket).toBe("medium");

      const shelfWithWordCount = body.shelf.find(
        (item) => item.id === MEMORY_SHELF_ID,
      );
      const shelfWithoutWordCount = body.shelf.find(
        (item) => item.id === MEMORY_NO_WORD_COUNT_ID,
      );
      expect(shelfWithWordCount?.lengthBucket).toBe("short");
      expect(shelfWithoutWordCount?.lengthBucket).toBeNull();
    });

    it("returns documented JSON shape for /memories/:id with nullable wordCount and lengthBucket and 404 for missing memory (AC 16)", async () => {
      const { config } = await setupWorkspace();
      const connection = initializeDatabase(config);
      const t5 = new Date("2026-06-05T08:00:00.000Z");
      try {
        await connection.repositories.memories.create({
          id: MEMORY_NO_WORD_COUNT_ID,
          url: "https://legacy.example/pre-migration-article",
          title: "Legacy Article Without Word Count",
          description: null,
          faviconUrl: null,
          contentPath: `memories/${MEMORY_NO_WORD_COUNT_ID}/CONTENT.md`,
          extractionStatus: "success",
          extractionError: null,
          backupStatus: "disabled",
          triageState: "shelf",
          triageChangedAt: t5,
          wordCount: null,
          createdAt: t5,
          updatedAt: t5,
        });

        await writeMemoryContent({
          config: { storePath: config.storePath },
          memoryId: MEMORY_NO_WORD_COUNT_ID,
          overwrite: true,
          frontmatter: {
            id: MEMORY_NO_WORD_COUNT_ID,
            url: "https://legacy.example/pre-migration-article",
            title: "Legacy Article Without Word Count",
            capturedAt: t5.toISOString(),
            extractionStatus: "success",
          },
          markdown: "# Legacy Article\n\nBody stored before word_count backfill.",
        });

        await writeMemoryContent({
          config: { storePath: config.storePath },
          memoryId: MEMORY_LIBRARY_ID,
          overwrite: true,
          frontmatter: {
            id: MEMORY_LIBRARY_ID,
            url: "https://library.example/long-essay",
            title: "Long Essay",
            capturedAt: t5.toISOString(),
            extractionStatus: "success",
          },
          markdown: "# Long Essay\n\nLong essay body.",
        });
      } finally {
        connection.close();
      }

      const mediumResponse = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}`,
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(mediumResponse.status).toBe(200);
      const mediumBody =
        (await mediumResponse.json()) as AgentMemoryReadingStateResponse;

      expect(Object.keys(mediumBody).sort()).toEqual([
        "activeVariant",
        "capturedAt",
        "categories",
        "createdAt",
        "description",
        "domain",
        "extractionStatus",
        "faviconUrl",
        "flashbacks",
        "id",
        "lastOpenedAt",
        "lastPosition",
        "lengthBucket",
        "markdown",
        "moments",
        "read",
        "tags",
        "title",
        "toc",
        "triageChangedAt",
        "triageState",
        "updatedAt",
        "url",
        "variants",
        "wordCount",
      ]);
      expect(Object.keys(mediumBody.activeVariant).sort()).toEqual([
        "kind",
        "langCode",
        "relativePath",
      ]);
      expect(mediumBody.wordCount).toBe(920);
      expect(mediumBody.lengthBucket).toBe("medium");

      const longResponse = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_LIBRARY_ID}`,
          ),
          { memoryId: MEMORY_LIBRARY_ID },
        ),
      );
      expect(longResponse.status).toBe(200);
      const longBody =
        (await longResponse.json()) as AgentMemoryReadingStateResponse;
      expect(longBody.wordCount).toBe(2400);
      expect(longBody.lengthBucket).toBe("long");

      const nullCountResponse = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_NO_WORD_COUNT_ID}`,
          ),
          { memoryId: MEMORY_NO_WORD_COUNT_ID },
        ),
      );
      expect(nullCountResponse.status).toBe(200);
      const nullCountBody =
        (await nullCountResponse.json()) as AgentMemoryReadingStateResponse;
      expect(nullCountBody.wordCount).toBeNull();
      expect(nullCountBody.lengthBucket).toBeNull();

      const missingResponse = await GET_AGENT_MEMORY(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MISSING_MEMORY_ID}`,
          ),
          { memoryId: MISSING_MEMORY_ID },
        ),
      );
      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json()).toEqual({
        error: "memory was not found",
      });
    });

    it("returns documented JSON shapes for /triage and /ask endpoints (AC 16)", async () => {
      const { config } = await setupWorkspace();
      const lease = ensureRuntimeProcessLease(config);
      leaseDisposers.push(() => lease.release());

      const triageResponse = await POST_AGENT_TRIAGE(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ triageState: "library" }),
            },
          ),
          { memoryId: MEMORY_SHELF_ID },
        ),
      );
      expect(triageResponse.status).toBe(200);
      const triageBody = (await triageResponse.json()) as AgentTriageResponse;
      expect(Object.keys(triageBody).sort()).toEqual([
        "changed",
        "memoryId",
        "triageChangedAt",
        "triageState",
      ]);

      const fakeClient = new FakePsychiatristClient();
      const askHandler = createAgentAskHandler({
        config,
        startThread: (forwarded) =>
          handleStartPsychiatristThreadRequest(forwarded, { config }),
        sendMessage: (forwarded) =>
          handleSendPsychiatristMessageRequest(forwarded, {
            config,
            client: fakeClient,
          }),
      });
      const askResponse = await askHandler(
        createApiEvent(
          new Request(
            `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "simplify",
                sectionAnchor: "in-situ-assistance",
              }),
            },
          ),
          { memoryId: MEMORY_TODAY_ID },
        ),
      );
      expect(askResponse.status).toBe(202);
      const askBody = (await askResponse.json()) as AgentAskResponse;
      expect(Object.keys(askBody).sort()).toEqual([
        "eventsUrl",
        "groundedContext",
        "pairId",
        "threadId",
        "turnId",
      ]);
      expect(Object.keys(askBody.groundedContext).sort()).toEqual([
        "action",
        "domain",
        "langCode",
        "memoryId",
        "memoryTitle",
        "prompt",
        "sectionAnchor",
        "sectionTitle",
        "selectedText",
        "variantKind",
      ]);

      await waitForDetachedTurnToFinish(askBody.turnId);
    });

    it("returns 401 without echoing token for wrong bearer token across /api/agent/v1 endpoints when TRAUMA_API_TOKEN is configured (AC 16)", async () => {
      await setupWorkspace();
      const configuredToken = "test-token";
      const wrongToken = "wrong-test-token";
      process.env[TRAUMA_API_TOKEN_ENV_VAR] = configuredToken;

      const responses = await Promise.all([
        GET_AGENT_CONTEXT(
          createApiEvent(
            new Request("http://localhost/api/agent/v1/context", {
              headers: { authorization: `Bearer ${wrongToken}` },
            }),
          ),
        ),
        GET_AGENT_MEMORY(
          createApiEvent(
            new Request(
              `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}`,
              {
                headers: { authorization: `Bearer ${wrongToken}` },
              },
            ),
            { memoryId: MEMORY_TODAY_ID },
          ),
        ),
        POST_AGENT_TRIAGE(
          createApiEvent(
            new Request(
              `http://localhost/api/agent/v1/memories/${MEMORY_SHELF_ID}/triage`,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${wrongToken}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ triageState: "library" }),
              },
            ),
            { memoryId: MEMORY_SHELF_ID },
          ),
        ),
        POST_AGENT_ASK(
          createApiEvent(
            new Request(
              `http://localhost/api/agent/v1/memories/${MEMORY_TODAY_ID}/ask`,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${wrongToken}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ action: "simplify" }),
              },
            ),
            { memoryId: MEMORY_TODAY_ID },
          ),
        ),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
        const text = await response.text();
        expect(text).not.toContain(configuredToken);
        expect(text).not.toContain(wrongToken);
        expect(JSON.parse(text)).toEqual({ error: "invalid API token" });
      }

      const withoutHeader = await GET_AGENT_CONTEXT(
        createApiEvent(new Request("http://localhost/api/agent/v1/context")),
      );
      expect(withoutHeader.status).toBe(200);

      const withValidToken = await GET_AGENT_CONTEXT(
        createApiEvent(
          new Request("http://localhost/api/agent/v1/context", {
            headers: { authorization: `Bearer ${configuredToken}` },
          }),
        ),
      );
      expect(withValidToken.status).toBe(200);
    });
  });
});
