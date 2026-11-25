import { describe, expect, it } from "vitest";

import {
  OpenAICompatibleClient,
  type OpenAICompatibleFetch,
  normalizeOpenAIBaseUrl,
  redactOpenAISecrets,
} from "../../../src/server/llm/openai-compatible-client";
import {
  CodexAppServerError,
  type CodexAppServerEvent,
} from "../../../src/server/translation/codex-app-server";
import type { TranslationChunk } from "../../../src/server/translation/types";

function sseStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function makeChunk(): TranslationChunk {
  return {
    jobId: "job-1",
    memoryId: "mem-1",
    langCode: "fr",
    sourceHash: "hash-1",
    chunkIndex: 0,
    chunkCount: 1,
    sectionPath: [],
    docTitle: "Sample",
    sourceUrl: null,
    documentType: "article",
    styleProfile: null,
    glossary: {},
    blockIds: ["block-1"],
    sourceBlocks: [
      {
        id: "block-1",
        type: "paragraph",
        markdown: "Hello world.",
        sectionPath: [],
        sourceStart: 0,
        sourceEnd: 12,
        protectedSpans: [],
        metadata: {},
      },
    ],
    sourceMarkdown: "Hello world.",
    sourceChunkHash: "chunk-hash-1",
    segments: [
      {
        id: "seg-1",
        blockId: "block-1",
        sourceStart: 0,
        sourceEnd: 12,
        sourceDocumentStart: 0,
        sourceDocumentEnd: 12,
        sourceReaderStart: 0,
        sourceReaderEnd: 12,
        text: "Hello world.",
      },
    ],
  };
}

describe("OpenAICompatibleClient", () => {
  it("normalizes base URLs and fails closed on missing, invalid, or credentialed URLs", () => {
    expect(normalizeOpenAIBaseUrl("https://sibyl.haunted.fail/llm/v1/")).toBe(
      "https://sibyl.haunted.fail/llm/v1",
    );
    expect(normalizeOpenAIBaseUrl("http://127.0.0.1:3425/v1///")).toBe(
      "http://127.0.0.1:3425/v1",
    );

    for (const invalid of [
      "",
      "   ",
      "not-a-url",
      "ftp://example.com/v1",
      "https://user:pass@example.com/v1",
    ]) {
      expect(() => normalizeOpenAIBaseUrl(invalid)).toThrowError(
        CodexAppServerError,
      );
      try {
        normalizeOpenAIBaseUrl(invalid);
      } catch (error) {
        expect((error as CodexAppServerError).code).toBe("setup_required");
      }
    }
  });

  it("streams SSE deltas cleanly across split chunks and emits lifecycle events", async () => {
    const requests: Array<{
      headers: Headers;
      body: Record<string, unknown>;
      url: string;
    }> = [];
    const fetchMock: OpenAICompatibleFetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        sseStream([
          'data: {"id":"cmpl-1","choices":[{"delta":{"content":"Hel',
          'lo "}}]}\n\n',
          'data: {"id":"cmpl-1","choices":[{"delta":{"content":"world"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };

    const client = new OpenAICompatibleClient({
      baseUrl: "https://sibyl.haunted.fail/llm/v1/",
      apiKey: "secret-magpie-token-12345",
      defaultModel: "magpie-chat",
      fetch: fetchMock,
    });

    const events: CodexAppServerEvent[] = [];
    const result = await client.runConversationTurn({
      cwdPurpose: "psychiatrist",
      input: "How are you?",
      threadId: "thread-abc",
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.outputText).toBe("Hello world");
    expect(result.threadId).toBe("thread-abc");
    expect(result.turnId).toMatch(/^openai-turn-/);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://sibyl.haunted.fail/llm/v1/chat/completions",
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer secret-magpie-token-12345",
    );
    expect(requests[0]?.body).toEqual({
      model: "magpie-chat",
      stream: true,
      messages: [{ role: "user", content: "How are you?" }],
    });

    expect(events.map((event) => event.type)).toEqual([
      "thread.started",
      "turn.started",
      "delta",
      "delta",
      "item.completed",
    ]);
    expect(
      events
        .filter((event) => event.type === "delta")
        .map((event) => event.text),
    ).toEqual(["Hello ", "world"]);
  });

  it("cancels an in-flight streaming turn cleanly via AbortController", async () => {
    let observedSignal: AbortSignal | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const fetchMock: OpenAICompatibleFetch = async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      resolveStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      });
    };

    const client = new OpenAICompatibleClient({
      baseUrl: "http://127.0.0.1:3425/v1",
      defaultModel: "magpie-chat",
      fetch: fetchMock,
    });

    let startedThreadId = "";
    let startedTurnId = "";
    const turnPromise = client.runConversationTurn({
      cwdPurpose: "psychiatrist",
      input: "Long response",
      onEvent(event) {
        if (event.type === "thread.started") {
          startedThreadId = event.threadId;
        } else if (event.type === "turn.started") {
          startedTurnId = event.turnId;
        }
      },
    });

    await started;
    await client.cancelTurn({ threadId: startedThreadId, turnId: startedTurnId });

    await expect(turnPromise).rejects.toMatchObject({
      name: "CodexAppServerError",
      code: "turn_interrupted",
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("aborts and fails closed with event_limit_exceeded on event consumer backpressure", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock: OpenAICompatibleFetch = async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Response(
        sseStream([
          'data: {"choices":[{"delta":{"content":"chunk-1"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"chunk-2"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    };

    const client = new OpenAICompatibleClient({
      baseUrl: "http://127.0.0.1:3425/v1",
      defaultModel: "magpie-chat",
      fetch: fetchMock,
    });

    await expect(
      client.runConversationTurn({
        cwdPurpose: "psychiatrist",
        input: "Trigger backpressure",
        onEvent(event) {
          if (event.type === "delta") {
            return false;
          }
          return true;
        },
      }),
    ).rejects.toMatchObject({
      name: "CodexAppServerError",
      code: "event_limit_exceeded",
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("translates chunks using non-streaming JSON and falls back if response_format is unsupported", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock: OpenAICompatibleFetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      requestBodies.push(body);
      if (body.response_format !== undefined) {
        return new Response(
          JSON.stringify({
            error: { message: "response_format json_object is not supported" },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  '```json\n{"chunk_index":0,"segments":[{"id":"seg-1","translated_text":"Bonjour le monde."}],"warnings":[]}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new OpenAICompatibleClient({
      baseUrl: "http://127.0.0.1:3425/v1",
      defaultModel: "magpie-translate",
      fetch: fetchMock,
    });

    const result = await client.translateChunk({
      chunk: makeChunk(),
      prompt: "Translate to French",
    });

    expect(result).toEqual({
      chunk_index: 0,
      segments: [{ id: "seg-1", translated_text: "Bonjour le monde." }],
      warnings: [],
    });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.stream).toBe(false);
    expect(requestBodies[0]?.response_format).toEqual({ type: "json_object" });
    expect(requestBodies[1]?.response_format).toBeUndefined();
  });

  it("fails closed on malformed translation JSON output", async () => {
    const fetchMock: OpenAICompatibleFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not valid json" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const client = new OpenAICompatibleClient({
      baseUrl: "http://127.0.0.1:3425/v1",
      defaultModel: "magpie-translate",
      fetch: fetchMock,
    });

    await expect(
      client.translateChunk({
        chunk: makeChunk(),
        prompt: "Translate",
      }),
    ).rejects.toMatchObject({
      name: "CodexAppServerError",
      code: "invalid_final_output",
    });
  });

  it("lists models via GET /models and checks auth connectivity", async () => {
    const fetchMock: OpenAICompatibleFetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("https://sibyl.haunted.fail/llm/v1/models");
      return new Response(
        JSON.stringify({
          data: [
            { id: "model-a", owned_by: "magpie" },
            {
              id: "model-b",
              display_name: "Model B",
              description: "Fast model",
            },
            { id: "model-a", owned_by: "duplicate" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const client = new OpenAICompatibleClient({
      baseUrl: "https://sibyl.haunted.fail/llm/v1",
      defaultModel: "model-b",
      fetch: fetchMock,
    });

    const catalog = await client.listModels();
    expect(catalog.models).toHaveLength(2);
    expect(catalog.models[0]).toMatchObject({
      id: "model-a",
      model: "model-a",
      isDefault: false,
      description: "Owned by magpie",
    });
    expect(catalog.models[1]).toMatchObject({
      id: "model-b",
      model: "model-b",
      displayName: "Model B",
      description: "Fast model",
      isDefault: true,
    });

    const auth = await client.checkAuth();
    expect(auth).toEqual({ status: "enabled" });
  });

  it("maps HTTP 401/429/5xx and malformed SSE chunks to structured errors while redacting API keys", async () => {
    const secretKey = "sk-live-super-secret-999999";

    const cases: Array<{
      status: number;
      body: string;
      expectedCode: CodexAppServerError["code"];
    }> = [
      {
        status: 401,
        body: JSON.stringify({
          error: {
            message: `Invalid api_key=${secretKey} for Bearer ${secretKey}`,
          },
        }),
        expectedCode: "auth_required",
      },
      {
        status: 429,
        body: JSON.stringify({
          error: { message: `Rate limited for token ${secretKey}` },
        }),
        expectedCode: "usage_limit",
      },
      {
        status: 503,
        body: `Upstream failure with key ${secretKey}`,
        expectedCode: "app_server_unavailable",
      },
    ];

    for (const testCase of cases) {
      const client = new OpenAICompatibleClient({
        baseUrl: "https://sibyl.haunted.fail/llm/v1",
        apiKey: secretKey,
        defaultModel: "magpie-chat",
        fetch: async () =>
          new Response(testCase.body, {
            status: testCase.status,
            headers: { "Content-Type": "application/json" },
          }),
      });

      let caught: unknown;
      try {
        await client.runConversationTurn({
          cwdPurpose: "psychiatrist",
          input: "ping",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CodexAppServerError);
      const err = caught as CodexAppServerError;
      expect(err.code).toBe(testCase.expectedCode);
      expect(err.message).not.toContain(secretKey);
      expect(err.message).toContain("[REDACTED]");
    }

    // Malformed SSE chunk fails closed without leaking secrets
    const malformedSseClient = new OpenAICompatibleClient({
      baseUrl: "https://sibyl.haunted.fail/llm/v1",
      apiKey: secretKey,
      defaultModel: "magpie-chat",
      fetch: async () =>
        new Response(
          sseStream([`data: {not-json ${secretKey}\n\n`]),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        ),
    });

    let sseError: unknown;
    try {
      await malformedSseClient.runConversationTurn({
        cwdPurpose: "psychiatrist",
        input: "ping",
      });
    } catch (error) {
      sseError = error;
    }
    expect(sseError).toBeInstanceOf(CodexAppServerError);
    expect((sseError as CodexAppServerError).code).toBe(
      "app_server_protocol_error",
    );
    expect((sseError as CodexAppServerError).message).not.toContain(secretKey);

    // Direct redaction helper check
    expect(
      redactOpenAISecrets(
        `Authorization: Bearer tok-abc123 api_key:my-secret sk-abcdefgh1234`,
        "my-secret",
      ),
    ).toBe("Authorization: Bearer [REDACTED] api_key:[REDACTED] [REDACTED]");
  });
});
