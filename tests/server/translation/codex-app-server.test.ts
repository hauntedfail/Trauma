import { createHash } from "node:crypto";
import net from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CodexAppServerClient,
  CodexAppServerError,
  parseCodexAppServerEndpoint,
} from "../../../src/server/translation/codex-app-server";
import { parseMarkdownTranslationBlocks } from "../../../src/server/translation/markdown-blocks";
import { createTranslationSegmentManifest } from "../../../src/server/translation/translation-segments";
import type { TranslationChunk } from "../../../src/server/translation/types";

const originalSocketPath = process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH;
const originalRuntimeDir = process.env.TRAUMA_CODEX_RUNTIME_DIR;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalSocketPath === undefined) {
    delete process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH;
  } else {
    process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = originalSocketPath;
  }
  if (originalRuntimeDir === undefined) {
    delete process.env.TRAUMA_CODEX_RUNTIME_DIR;
  } else {
    process.env.TRAUMA_CODEX_RUNTIME_DIR = originalRuntimeDir;
  }
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Codex app-server endpoint parsing", () => {
  it("accepts explicitly configured Unix sockets", () => {
    expect(parseCodexAppServerEndpoint("unix:///tmp/trauma-codex.sock"))
      .toEqual({
        kind: "unix_socket",
        raw: "unix:///tmp/trauma-codex.sock",
        socketPath: "/tmp/trauma-codex.sock",
      });
  });

  it("resolves bare unix endpoints through the dedicated socket path env", () => {
    process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = "/tmp/brilliant.sock";

    expect(parseCodexAppServerEndpoint("unix://")).toMatchObject({
      kind: "unix_socket",
      socketPath: "/tmp/brilliant.sock",
    });
  });

  it("rejects HTTP and stdio as app-server wire transports", () => {
    expect(() => parseCodexAppServerEndpoint("https://localhost:1234"))
      .toThrow(CodexAppServerError);
    expect(() => parseCodexAppServerEndpoint("stdio://"))
      .toThrow(CodexAppServerError);
  });

  it("translates a chunk through the Unix-socket app-server wire protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });
      const events: string[] = [];
      const output = await client.translateChunk({
        chunk: createChunk(),
        onEvent: (event) => events.push(event.type),
        prompt: "translate chunk",
      });

      expect(output).toEqual({
        chunk_index: 0,
        segments: [{ id: "s000001", translated_text: "翻訳本文" }],
        translated_markdown: "翻訳本文",
        warnings: [],
      });
      expect(receivedMethods).toEqual([
        "initialize",
        "initialized",
        "account/read",
        "thread/start",
        "turn/start",
      ]);
      expect(events).toContain("thread.started");
      expect(events).toContain("turn.started");
      expect(events).toContain("delta");
      expect(events).toContain("item.completed");
    } finally {
      await server.close();
    }
  });

  it("keeps focused protocol fixtures in the app-server wire envelope shape", async () => {
    const fixtureText = await readFile(
      new URL(
        "../../fixtures/translation/codex-app-server-protocol.focused.json",
        import.meta.url,
      ),
      "utf8",
    );
    const fixture = JSON.parse(fixtureText) as FocusedProtocolFixture;

    expect(fixtureText).not.toContain("\"jsonrpc\"");
    expect(fixture.schemaFacts.threadStart.stableOmittedFields).toEqual([
      "environments",
      "experimentalRawEvents",
      "persistExtendedHistory",
    ]);
    expect(fixture.schemaFacts.turnStart.supportsOutputSchema).toBe(true);
    expect(fixture.schemaFacts.turnStart.stableOmittedFields).toEqual([
      "environments",
    ]);
    expect(fixture.schemaFacts.turnStart.readOnlySandboxPolicy).toEqual({
      type: "readOnly",
      networkAccessType: "boolean",
    });
    expect(fixture.wireExamples.map((example) => example.message.method))
      .toEqual(expect.arrayContaining([
        "initialize",
        "initialized",
        "account/read",
        "account/login/start",
        "account/login/completed",
        "account/updated",
        "account/login/cancel",
        "account/logout",
        "thread/start",
        "turn/start",
        "turn/interrupt",
        "turn/started",
        "item/agentMessage/delta",
        "item/completed",
        "turn/completed",
      ]));
  });

  it("destroys the Unix socket when WebSocket upgrade is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-upgrade-reject-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const server = await startRejectingUpgradeServer(socketPath);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).rejects.toMatchObject({
        code: "app_server_unavailable",
      });
      await waitFor(() => server.activeSocketCount() === 0);
    } finally {
      await server.close();
    }
  });

  it("rejects pending requests and replies when the app-server sends a WebSocket close frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-close-frame-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const controlFrames: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      controlFrames,
      sendCloseBeforeAccountReadResponse: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).rejects.toMatchObject({
        code: "stream_disconnected",
      });
      await server.waitForSocketClose();
      expect(controlFrames).toContain("close:closing");
    } finally {
      await server.close();
    }
  });

  it("falls back to prompt-only turn starts when output schemas are unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-schema-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      rejectOutputSchemaOnce: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      const output = await client.translateChunk({
        chunk: createChunk(),
        outputSchema: {
          type: "object",
          required: ["segments"],
          properties: {
            segments: { type: "array" },
          },
        },
        prompt: "translate chunk",
      });

      expect(output.segments).toEqual([
        { id: "s000001", translated_text: "翻訳本文" },
      ]);
      expect(receivedMethods.filter((method) => method === "thread/start"))
        .toHaveLength(2);
      expect(receivedMethods.filter((method) => method === "turn/start"))
        .toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("maps interrupted turns without final output to a cancellation-shaped error", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-interrupted-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      sendInterruptedTurnCompletion: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(
        client.translateChunk({
          chunk: createChunk(),
          prompt: "translate chunk",
        }),
      ).rejects.toMatchObject({
        code: "turn_interrupted",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects loopback WebSocket endpoints because TRAUMA only supports Unix sockets", () => {
    expect(() => parseCodexAppServerEndpoint("ws://127.0.0.1:4500"))
      .toThrow("Unsupported Codex app-server endpoint.");
  });

  it("lists visible Codex models from the app-server catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-models-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      modelListResponse: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Deeper" },
            ],
          },
          {
            id: "legacy-hidden",
            model: "legacy-hidden",
            displayName: "Legacy hidden",
            description: "Hidden model",
            hidden: true,
            isDefault: false,
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
            ],
          },
        ],
        nextCursor: null,
      },
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.listModels()).resolves.toEqual({
        models: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ],
      });
      expect(receivedMethods).toEqual([
        "initialize",
        "initialized",
        "model/list",
      ]);
    } finally {
      await server.close();
    }
  });

  it("rejects malformed Codex model catalog responses as protocol errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-bad-models-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      modelListResponse: {
        data: [
          {
            id: "gpt-bad",
            displayName: "Bad model",
            hidden: false,
            isDefault: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [],
          },
        ],
      },
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.listModels()).rejects.toMatchObject({
        code: "app_server_protocol_error",
      });
    } finally {
      await server.close();
    }
  });

  it("sends only stable app-server fields when experimentalApi is not negotiated", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-stable-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const receivedMessages: CapturedClientMessage[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      receivedMessages,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await client.translateChunk({
        chunk: createChunk(),
        outputSchema: { type: "object" },
        prompt: "translate chunk",
      });

      const initialize = findCapturedRequest(receivedMessages, "initialize");
      expect(initialize.params).toMatchObject({ capabilities: null });

      const threadStart = findCapturedRequest(receivedMessages, "thread/start");
      expect(threadStart.params).toMatchObject({
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        ephemeral: true,
        sandbox: "read-only",
        threadSource: "user",
      });
      expect(threadStart.params).not.toHaveProperty("environments");
      expect(threadStart.params).not.toHaveProperty("experimentalRawEvents");
      expect(threadStart.params).not.toHaveProperty("persistExtendedHistory");

      const turnStart = findCapturedRequest(receivedMessages, "turn/start");
      expect(turnStart.params).toMatchObject({
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        outputSchema: { type: "object" },
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        threadId: "thread-1",
      });
      expect(turnStart.params).not.toHaveProperty("environments");
    } finally {
      await server.close();
    }
  });

  it("passes selected model and reasoning effort through turn/start", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-model-turn-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const receivedMessages: CapturedClientMessage[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      receivedMessages,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await client.translateChunk({
        chunk: createChunk(),
        model: "gpt-5.5",
        outputSchema: { type: "object" },
        prompt: "translate chunk",
        reasoningEffort: "high",
      });

      const turnStart = findCapturedRequest(receivedMessages, "turn/start");
      expect(turnStart.params).toMatchObject({
        model: "gpt-5.5",
        effort: "high",
      });
      expect(turnStart.params).not.toHaveProperty("reasoningEffort");
      expect(turnStart.params).not.toHaveProperty("reasoning_effort");
    } finally {
      await server.close();
    }
  });

  it("classifies reachable app-server gated-field rejections as protocol errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-protocol-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      rejectThreadStartWithExperimentalCapabilityError: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(
        client.translateChunk({
          chunk: createChunk(),
          prompt: "translate chunk",
        }),
      ).rejects.toMatchObject({
        code: "app_server_protocol_error",
        message: "thread/start.environments requires experimentalApi capability",
      });
    } finally {
      await server.close();
    }
  });

  it("uses Codex account methods for device-code auth without exposing credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-auth-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.startDeviceCodeLogin()).resolves.toEqual({
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://example.com/device",
      });
      await expect(client.cancelDeviceCodeLogin({ loginId: "login-1" }))
        .resolves.toBeUndefined();
      await expect(client.logout()).resolves.toEqual({ status: "logged_out" });

      expect(receivedMethods).toEqual([
        "initialize",
        "initialized",
        "account/login/start",
        "account/login/cancel",
        "account/logout",
      ]);
    } finally {
      await server.close();
    }
  });

  it("treats a returned account as authenticated even when OpenAI auth is required", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-account-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      accountReadResponse: {
        account: {
          email: "user@example.com",
          planType: "prolite",
          type: "chatgpt",
        },
        requiresOpenaiAuth: true,
      },
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).resolves.toEqual({ status: "enabled" });
    } finally {
      await server.close();
    }
  });

  it("requires auth when OpenAI auth is required and no account is returned", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-no-account-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      accountReadResponse: {
        account: null,
        requiresOpenaiAuth: true,
      },
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).resolves.toEqual({
        status: "setup_required",
        reason: "auth_required",
      });
    } finally {
      await server.close();
    }
  });

  it("observes official account auth notifications as typed auth events", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-auth-events-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      authNotificationsAfterLogin: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });
      const iterator = client.observeAuthEvents()[Symbol.asyncIterator]();
      const firstEvent = iterator.next();
      const secondEvent = iterator.next();

      await client.startDeviceCodeLogin();

      await expect(firstEvent).resolves.toEqual({
        done: false,
        value: {
          type: "account.login.completed",
          loginId: "login-1",
          success: true,
          error: null,
        },
      });
      await expect(secondEvent).resolves.toEqual({
        done: false,
        value: { type: "account.updated" },
      });
    } finally {
      await server.close();
    }
  });

  it("completes auth event iterators when the app-server connection closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-auth-close-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    let serverClosed = false;
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });
      const iterator = client.observeAuthEvents()[Symbol.asyncIterator]();

      await client.startDeviceCodeLogin();
      const pendingEvent = iterator.next();
      await server.close();
      serverClosed = true;

      await expect(pendingEvent).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } finally {
      if (!serverClosed) {
        await server.close();
      }
    }
  });

  it("sends turn interrupts through the app-server wire protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-cancel-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(
        client.cancelTurn({ threadId: "thread-1", turnId: "turn-1" }),
      ).resolves.toBeUndefined();

      expect(receivedMethods).toEqual([
        "initialize",
        "initialized",
        "turn/interrupt",
      ]);
    } finally {
      await server.close();
    }
  });

  it("fails an unfinished turn when the Unix socket closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-close-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      closeAfterTurnStart: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(
        client.translateChunk({
          chunk: createChunk(),
          prompt: "translate chunk",
        }),
      ).rejects.toMatchObject({ code: "stream_disconnected" });
    } finally {
      await server.close();
    }
  });

  it("rejects malformed app-server frames as protocol errors without leaving pending requests open", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-bad-frame-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      sendMalformedJsonAfterInitialize: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).rejects.toMatchObject({
        code: "app_server_protocol_error",
      });
    } finally {
      await server.close();
    }
  });

  it("closes Unix-socket app-server connections explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-explicit-close-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await client.checkAuth();
      expect(server.activeSocketCount()).toBe(1);

      await client.close();
      await server.waitForSocketClose();

      expect(server.activeSocketCount()).toBe(0);
      await expect(client.checkAuth()).rejects.toMatchObject({
        code: "stream_disconnected",
      });
    } finally {
      await server.close();
    }
  });

  it("reassembles fragmented Unix-socket WebSocket text messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-fragment-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      fragmentAccountReadResponse: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).resolves.toEqual({ status: "enabled" });
    } finally {
      await server.close();
    }
  });

  it("answers Unix-socket WebSocket ping frames with pong", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-ping-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const controlFrames: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      controlFrames,
      sendPingBeforeAccountReadResponse: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.checkAuth()).resolves.toEqual({ status: "enabled" });
      await waitFor(() => controlFrames.includes("pong:keepalive"));
      expect(controlFrames).toContain("pong:keepalive");
    } finally {
      await server.close();
    }
  });

  it("removes per-job runtime directories after translation attempts finish", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-runtime-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const runtimeRoot = join(root, "runtime");
    process.env.TRAUMA_CODEX_RUNTIME_DIR = runtimeRoot;
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await client.translateChunk({
        chunk: createChunk(),
        prompt: "translate chunk",
      });

      await expect(
        readFile(join(runtimeRoot, "019e3906-0000-7000-8000-000000000123")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await server.close();
    }
  });
});

function createChunk(): TranslationChunk {
  const sourceMarkdown = "Source body";
  const manifest = parseMarkdownTranslationBlocks(sourceMarkdown);
  const segmentManifest = createTranslationSegmentManifest(sourceMarkdown);
  return {
    blockIds: ["b000001"],
    chunkCount: 1,
    chunkIndex: 0,
    docTitle: "Source",
    documentType: "article",
    glossary: {},
    jobId: "019e3906-0000-7000-8000-000000000123",
    langCode: "ja-JP",
    memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f999",
    sectionPath: ["1"],
    sourceBlocks: manifest.blocks,
    sourceChunkHash: "sha256:chunk",
    sourceHash: "sha256:source",
    sourceMarkdown,
    sourceUrl: "https://example.com",
    segments: segmentManifest.segments,
    styleProfile: null,
  };
}

async function startFakeAppServer(
  socketPath: string,
  receivedMethods: string[],
  options: FakeAppServerOptions = {},
): Promise<{
  activeSocketCount: () => number;
  close: () => Promise<void>;
  waitForSocketClose: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  let resolveSocketClose: (() => void) | undefined;
  const socketClose = new Promise<void>((resolve) => {
    resolveSocketClose = resolve;
  });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      resolveSocketClose?.();
    });
    let upgraded = false;
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([
        buffer,
        typeof chunk === "string" ? Buffer.from(chunk) : chunk,
      ]);
      if (!upgraded) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const key = /^Sec-WebSocket-Key:\s*(.+)$/im.exec(header)?.[1]?.trim();
        if (key === undefined) {
          socket.destroy(new Error("missing websocket key"));
          return;
        }
        socket.write(createUpgradeResponse(key));
        buffer = buffer.slice(headerEnd + 4);
        upgraded = true;
      }

      for (const message of drainClientMessages()) {
        handleClientMessage(socket, receivedMethods, message, options);
      }
    });

    function drainClientMessages(): unknown[] {
      const messages: unknown[] = [];
      while (buffer.length >= 2) {
        const first = buffer[0] ?? 0;
        const second = buffer[1] ?? 0;
        const opcode = first & 0x0f;
        let offset = 2;
        let length = second & 0x7f;
        if (length === 126) {
          if (buffer.length < offset + 2) {
            break;
          }
          length = buffer.readUInt16BE(offset);
          offset += 2;
        } else if (length === 127) {
          if (buffer.length < offset + 8) {
            break;
          }
          length = Number(buffer.readBigUInt64BE(offset));
          offset += 8;
        }
        const masked = (second & 0x80) !== 0;
        const maskLength = masked ? 4 : 0;
        if (buffer.length < offset + maskLength + length) {
          break;
        }
        const mask = masked ? buffer.slice(offset, offset + 4) : undefined;
        offset += maskLength;
        const payload = Buffer.from(buffer.slice(offset, offset + length));
        buffer = buffer.slice(offset + length);
        if (mask !== undefined) {
          for (let index = 0; index < payload.length; index += 1) {
            payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
          }
        }
        if (opcode === 0x0a) {
          options.controlFrames?.push(`pong:${payload.toString("utf8")}`);
          continue;
        }
        if (opcode === 0x08) {
          options.controlFrames?.push(`close:${payload.toString("utf8")}`);
          continue;
        }
        if (opcode !== 0x1) {
          continue;
        }
        messages.push(JSON.parse(payload.toString("utf8")));
      }
      return messages;
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    activeSocketCount: () => sockets.size,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    waitForSocketClose: () => socketClose,
  };
}

async function startRejectingUpgradeServer(socketPath: string): Promise<{
  activeSocketCount: () => number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  let closed = false;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    socket.once("data", () => {
      socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    activeSocketCount: () => sockets.size,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (closed) {
        return;
      }
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function handleClientMessage(
  socket: net.Socket,
  receivedMethods: string[],
  value: unknown,
  options: FakeAppServerOptions = {},
): void {
  if (!isRecord(value) || typeof value.method !== "string") {
    return;
  }
  receivedMethods.push(value.method);
  const id = typeof value.id === "string" ? value.id : undefined;
  options.receivedMessages?.push({
    id,
    method: value.method,
    params: value.params,
  });
  switch (value.method) {
    case "initialize":
      if (options.sendMalformedJsonAfterInitialize === true) {
        socket.write(encodeServerWebSocketTextFrame("not json"));
        break;
      }
      sendJson(socket, { id, result: {} });
      break;
    case "account/read":
      if (options.sendCloseBeforeAccountReadResponse === true) {
        socket.write(encodeServerWebSocketControlFrame(0x08, "closing"));
        break;
      }
      if (options.sendPingBeforeAccountReadResponse === true) {
        socket.write(encodeServerWebSocketControlFrame(0x09, "keepalive"));
      }
      if (options.fragmentAccountReadResponse === true) {
        sendJsonFragmented(socket, {
          id,
          result: options.accountReadResponse ?? { requiresOpenaiAuth: false },
        });
      } else {
        sendJson(socket, {
          id,
          result: options.accountReadResponse ?? { requiresOpenaiAuth: false },
        });
      }
      break;
    case "account/login/start":
      sendJson(socket, {
        id,
        result: {
          loginId: "login-1",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://example.com/device",
        },
      });
      if (options.authNotificationsAfterLogin === true) {
        sendJson(socket, {
          method: "account/login/completed",
          params: {
            error: null,
            loginId: "login-1",
            success: true,
          },
        });
        sendJson(socket, {
          method: "account/updated",
          params: {
            authMode: "chatgpt",
            planType: "prolite",
          },
        });
      }
      break;
    case "account/login/cancel":
    case "account/logout":
      sendJson(socket, { id, result: {} });
      break;
    case "model/list":
      sendJson(socket, {
        id,
        result: options.modelListResponse ?? { data: [] },
      });
      break;
    case "thread/start":
      if (
        options.rejectThreadStartWithExperimentalCapabilityError === true
      ) {
        sendJson(socket, {
          id,
          error: {
            code: -32602,
            message: "thread/start.environments requires experimentalApi capability",
          },
        });
        break;
      }
      sendJson(socket, { id, result: { threadId: "thread-1" } });
      break;
    case "turn/start":
      if (
        options.rejectOutputSchemaOnce === true &&
        isRecord(value.params) &&
        "outputSchema" in value.params
      ) {
        options.rejectOutputSchemaOnce = false;
        sendJson(socket, {
          id,
          error: { message: "outputSchema is unsupported by this app-server" },
        });
        break;
      }
      sendJson(socket, { id, result: { turnId: "turn-1" } });
      if (options.closeAfterTurnStart === true) {
        socket.end();
        break;
      }
      if (options.sendInterruptedTurnCompletion === true) {
        sendJson(socket, {
          method: "turn/completed",
          params: {
            reason: "interrupted",
            status: "interrupted",
            threadId: "thread-1",
            turnId: "turn-1",
          },
        });
        break;
      }
      sendJson(socket, {
        method: "turn/started",
        params: { threadId: "thread-1", turnId: "turn-1" },
      });
      sendJson(socket, {
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", turnId: "turn-1", delta: "翻訳" },
      });
      sendJson(socket, {
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "item-1",
            text: JSON.stringify({
              chunk_index: 0,
              segments: [{ id: "s000001", translated_text: "翻訳本文" }],
              translated_markdown: "翻訳本文",
              warnings: [],
            }),
            type: "agentMessage",
          },
        },
      });
      break;
    case "turn/interrupt":
      sendJson(socket, { id, result: {} });
      break;
  }
}

interface FakeAppServerOptions {
  accountReadResponse?: unknown;
  authNotificationsAfterLogin?: boolean;
  closeAfterTurnStart?: boolean;
  controlFrames?: string[];
  fragmentAccountReadResponse?: boolean;
  modelListResponse?: unknown;
  receivedMessages?: CapturedClientMessage[];
  rejectThreadStartWithExperimentalCapabilityError?: boolean;
  rejectOutputSchemaOnce?: boolean;
  sendCloseBeforeAccountReadResponse?: boolean;
  sendInterruptedTurnCompletion?: boolean;
  sendPingBeforeAccountReadResponse?: boolean;
  sendMalformedJsonAfterInitialize?: boolean;
}

interface CapturedClientMessage {
  id?: string;
  method: string;
  params?: unknown;
}

function findCapturedRequest(
  messages: CapturedClientMessage[],
  method: string,
): { params: Record<string, unknown> } {
  const message = messages.find((candidate) => candidate.method === method);
  if (message === undefined || !isRecord(message.params)) {
    throw new Error(`Missing captured ${method} request.`);
  }
  return { params: message.params };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 250,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("condition was not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface FocusedProtocolFixture {
  schemaFacts: {
    threadStart: {
      stableOmittedFields: string[];
    };
    turnStart: {
      stableOmittedFields: string[];
      supportsOutputSchema: boolean;
      readOnlySandboxPolicy: {
        type: string;
        networkAccessType: string;
      };
    };
  };
  wireExamples: Array<{
    message: {
      method: string;
    };
  }>;
}

function createUpgradeResponse(key: string): string {
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n");
}

function sendJson(socket: net.Socket, value: unknown): void {
  socket.write(encodeServerWebSocketTextFrame(JSON.stringify(value)));
}

function sendJsonFragmented(socket: net.Socket, value: unknown): void {
  const text = JSON.stringify(value);
  const midpoint = Math.max(1, Math.floor(text.length / 2));
  socket.write(encodeServerWebSocketFrame({
    fin: false,
    opcode: 0x1,
    text: text.slice(0, midpoint),
  }));
  socket.write(encodeServerWebSocketFrame({
    fin: true,
    opcode: 0x0,
    text: text.slice(midpoint),
  }));
}

function encodeServerWebSocketControlFrame(opcode: number, text: string): Buffer {
  return encodeServerWebSocketFrame({ fin: true, opcode, text });
}

function encodeServerWebSocketTextFrame(text: string): Buffer {
  return encodeServerWebSocketFrame({ fin: true, opcode: 0x1, text });
}

function encodeServerWebSocketFrame(input: {
  fin: boolean;
  opcode: number;
  text: string;
}): Buffer {
  const payload = Buffer.from(input.text, "utf8");
  const first = (input.fin ? 0x80 : 0) | input.opcode;
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([first, payload.length]), payload]);
  }
  return Buffer.concat([
    Buffer.from([first, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]),
    payload,
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
