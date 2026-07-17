import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  findPersistedWebSourceRetryPair,
  isPsychiatristTranscriptNearBottom,
  PsychiatristDock,
  readPsychiatristReaderGenerationIdentity,
  shouldSubmitPsychiatristPromptOnKeyDown,
} from "../../src/components/reader/PsychiatristDock";
import {
  cancelPsychiatristTurn,
  createPsychiatristThread,
  getPsychiatristErrorMessage,
  PsychiatristRequestError,
  regeneratePsychiatristResponse,
  sendPsychiatristMessage,
} from "../../src/components/reader/psychiatrist-requests";
import {
  applyPsychiatristStreamEvent,
  toPsychiatristTranscriptPairs,
} from "../../src/components/reader/psychiatrist-transcript";

const dockSource = readFileSync(
  "src/components/reader/PsychiatristDock.tsx",
  "utf8",
);

describe("PsychiatristDock", () => {
  it("renders a collapsed home-bar trigger with an accessible name", () => {
    const html = renderToString(() =>
      createComponent(PsychiatristDock, {
        memoryId: "memory-reader",
      }),
    );

    expect(html).toContain('aria-label="Open Psychiatrist"');
    expect(html).toContain('data-psychiatrist-dock="collapsed"');
    expect(html).not.toContain("Ask questions about this memory");
  });

  it("clears phone primary tabs through the shell breakpoint without moving larger layouts", () => {
    expect(dockSource).toContain(
      "bottom-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))]",
    );
    expect(dockSource).toContain("min-[721px]:bottom-6");
    expect(dockSource).not.toContain("sm:bottom-6");
  });

  it("gives the prompt textarea a stable accessible label", () => {
    expect(dockSource).toContain('for="psychiatrist-prompt"');
    expect(dockSource).toContain(">Message Psychiatrist</label>");
    expect(dockSource).toContain('id="psychiatrist-prompt"');
  });

  it("keeps the dock source wired for keyboard close, stop, regenerate, and reduced motion", () => {
    expect(dockSource).toContain('reason === "escape"');
    expect(dockSource).toContain("handleStop");
    expect(dockSource).toContain("cancelPsychiatristTurn");
    expect(dockSource).toContain("regeneratePsychiatristResponse");
    expect(dockSource).toContain("prefers-reduced-motion");
    expect(dockSource).toContain("shiftKey");
    expect(dockSource).toContain("Enter");
  });

  it("joins the shared topmost dismissable layer without outside-pointer dismissal", () => {
    expect(dockSource).toContain('import { useDismissableLayer } from "../ui/dismissable-layer"');
    expect(dockSource).toContain("useDismissableLayer({");
    expect(dockSource).toContain("isEnabled: isOpen");
    expect(dockSource).toContain("shouldIgnoreOutsidePointerDown: () => true");

    const keyHandlerStart = dockSource.indexOf(
      "const handleKeyDown = (event: KeyboardEvent) =>",
    );
    const keyHandlerEnd = dockSource.indexOf(
      "const handleStreamEvent = (",
      keyHandlerStart,
    );
    const keyHandler = dockSource.slice(keyHandlerStart, keyHandlerEnd);
    expect(keyHandler).not.toContain('event.key === "Escape"');
    expect(keyHandler).toContain("shouldSubmitPsychiatristPromptOnKeyDown");
  });

  it("keeps web-source approval scoped to a single retry turn", () => {
    expect(dockSource).toContain("webSourceRetryPrompt");
    expect(dockSource).toContain("webSourceRetryPairId");
    expect(dockSource).toContain("network_permission_required");
    expect(dockSource).toContain("Allow web sources for this turn");
    expect(dockSource).toContain("allow_for_this_turn");
    expect(dockSource).toContain("psychiatrist.network.permission_required");
    expect(dockSource).toContain("const retryPairId = event.type === \"psychiatrist.network.permission_required\"");
    expect(dockSource).toContain("readPairId(event.data) ?? \"\"");
    expect(dockSource).toContain("setWebSourceRetryPairId(retryPairId)");
    expect(dockSource).toContain("regeneratePairById(retryPairId, \"allow_for_this_turn\")");
    expect(dockSource).not.toContain("localStorage");
  });

  it("restores web-source approval controls for persisted retry turns", () => {
    expect(dockSource).toContain("findPersistedWebSourceRetryPair");
    expect(dockSource).toContain("pair?.retryAction === \"allow_web_sources\"");
    expect(dockSource).toContain("setWebSourceRetryPrompt(retryPair.userPrompt)");
    expect(dockSource).toContain("setWebSourceRetryPairId(retryPair.pairId)");
  });

  it("discovers persisted regenerate web-source retries on completed pairs", () => {
    const retryPair = findPersistedWebSourceRetryPair([
      {
        answer: "Completed answer.",
        citations: [],
        pairId: "pair-regenerate",
        process: [],
        retryAction: "allow_web_sources",
        status: "completed",
        turnId: "turn-original",
        userPrompt: "Need current source?",
      },
    ]);

    expect(retryPair).toMatchObject({
      pairId: "pair-regenerate",
      retryAction: "allow_web_sources",
      status: "completed",
      userPrompt: "Need current source?",
    });
  });

  it("clears stale running state when a reloaded thread has no active turn", () => {
    expect(dockSource).toContain("const clearRunningTurnState = () =>");
    expect(dockSource).toContain("clearRunningTurnState()");
    expect(dockSource).toContain("disconnectPsychiatristStream = undefined");
  });

  it("resets loaded psychiatrist state when the reader generation identity changes", () => {
    expect(dockSource).toContain("createEffect");
    expect(dockSource).toContain("readPsychiatristReaderGenerationIdentity(");
    expect(dockSource).toContain("resetThreadStateForMemoryChange");
    expect(dockSource).toContain("if (isOpen())");
    expect(dockSource).toContain("void loadThread()");
  });

  it("distinguishes memory, language, and variant in reader generation identity", () => {
    const source = readPsychiatristReaderGenerationIdentity(
      "memory-reader",
      undefined,
    );
    const translated = readPsychiatristReaderGenerationIdentity(
      "memory-reader",
      "ja-JP",
    );

    expect(source).not.toBe(translated);
    expect(translated).not.toBe(readPsychiatristReaderGenerationIdentity(
      "memory-reader",
      "ja-JP",
      "source",
    ));
    expect(translated).not.toBe(readPsychiatristReaderGenerationIdentity(
      "memory-other",
      "ja-JP",
    ));
  });

  it("scopes Enter submit handling to the prompt textarea", () => {
    expect(dockSource).toContain("event.target === inputRef");
    expect(dockSource).toContain("event.preventDefault()");
  });

  it("submits plain Enter but preserves IME composition and multiline input", () => {
    const plainEnter = {
      isComposing: false,
      key: "Enter",
      keyCode: 13,
      shiftKey: false,
      targetIsPrompt: true,
    };

    expect(shouldSubmitPsychiatristPromptOnKeyDown(plainEnter)).toBe(true);
    expect(shouldSubmitPsychiatristPromptOnKeyDown({
      ...plainEnter,
      isComposing: true,
    })).toBe(false);
    expect(shouldSubmitPsychiatristPromptOnKeyDown({
      ...plainEnter,
      keyCode: 229,
    })).toBe(false);
    expect(shouldSubmitPsychiatristPromptOnKeyDown({
      ...plainEnter,
      shiftKey: true,
    })).toBe(false);
    expect(shouldSubmitPsychiatristPromptOnKeyDown({
      ...plainEnter,
      targetIsPrompt: false,
    })).toBe(false);
  });

  it("detects the transcript bottom using a stable pixel threshold", () => {
    expect(isPsychiatristTranscriptNearBottom({
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 352,
    })).toBe(true);
    expect(isPsychiatristTranscriptNearBottom({
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 351,
    })).toBe(false);
    expect(isPsychiatristTranscriptNearBottom({
      clientHeight: 300,
      scrollHeight: 200,
      scrollTop: 0,
    })).toBe(true);
  });

  it("creates or resumes a source thread with network disabled by default", async () => {
    const requests: Request[] = [];
    const thread = await createPsychiatristThread({
      memoryId: "memory-reader",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return jsonResponse({
          active_turn: null,
          content_hash: "sha256:source",
          lang_code: null,
          memory_id: "memory-reader",
          pairs: [],
          status: "ready",
          thread_id: "thread-reader",
          variant_kind: "source",
        });
      },
    });

    expect(thread.thread_id).toBe("thread-reader");
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-reader/psychiatrist/threads", "POST"],
    ]);
    await expect(requests[0]?.json()).resolves.toEqual({
      resume_latest: true,
    });
  });

  it("maps app-server unavailable psychiatrist request errors to an actionable message", () => {
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "retry",
      code: "app_server_unavailable",
      message: "Codex app-server is unavailable.",
      responseStatus: 500,
    }))).toBe("Start the Codex app-server, then retry Psychiatrist.");
  });

  it("passes translated reader language when creating a thread", async () => {
    const requests: Request[] = [];
    await createPsychiatristThread({
      langCode: "ja-JP",
      memoryId: "memory-reader",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return jsonResponse({
          active_turn: null,
          content_hash: "sha256:ja",
          lang_code: "ja-JP",
          memory_id: "memory-reader",
          pairs: [],
          status: "ready",
          thread_id: "thread-reader",
          variant_kind: "translation",
        });
      },
    });

    await expect(requests[0]?.json()).resolves.toEqual({
      lang_code: "ja-JP",
      resume_latest: true,
    });
  });

  it("sends messages, stops turns, and regenerates completed pairs through planned routes", async () => {
    const requests: Request[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      if (String(input).includes("/cancel")) {
        return jsonResponse({
          status: "canceled",
          turn_id: "turn-reader",
        });
      }
      return jsonResponse({
        event_url: "/api/memories/memory-reader/psychiatrist/threads/thread-reader/turns/turn-reader/events?variant_kind=translation&lang_code=ja-JP",
        pair_id: "pair-reader",
        replay_url: "/api/memories/memory-reader/psychiatrist/threads/thread-reader/turns/turn-reader/events?variant_kind=translation&lang_code=ja-JP",
        status: "started",
        thread_id: "thread-reader",
        turn_id: "turn-reader",
      });
    };

    await sendPsychiatristMessage({
      fetch,
      langCode: "ja-JP",
      memoryId: "memory-reader",
      message: "What is the risk?",
      threadId: "thread-reader",
      variantKind: "translation",
    });
    const canceled = await cancelPsychiatristTurn({
      fetch,
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      turnId: "turn-reader",
      variantKind: "translation",
    });
    await regeneratePsychiatristResponse({
      fetch,
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      variantKind: "translation",
    });

    expect(canceled).toEqual({
      status: "canceled",
      turn_id: "turn-reader",
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-reader/psychiatrist/threads/thread-reader/messages", "POST"],
      ["http://localhost/api/memories/memory-reader/psychiatrist/threads/thread-reader/turns/turn-reader/cancel", "POST"],
      ["http://localhost/api/memories/memory-reader/psychiatrist/threads/thread-reader/pairs/pair-reader/regenerate", "POST"],
    ]);
    await expect(requests[0]?.json()).resolves.toEqual({
      lang_code: "ja-JP",
      message: "What is the risk?",
      variant_kind: "translation",
      web_source_permission: "deny",
    });
    await expect(requests[1]?.json()).resolves.toEqual({
      lang_code: null,
      memory_id: "memory-reader",
      pair_id: "pair-reader",
      thread_id: "thread-reader",
      variant_kind: "translation",
    });
    await expect(requests[2]?.json()).resolves.toEqual({
      lang_code: null,
      memory_id: "memory-reader",
      thread_id: "thread-reader",
      variant_kind: "translation",
      web_source_permission: "deny",
    });
  });

  it("accepts future optional fields in valid thread and nested pair responses", async () => {
    const thread = await createPsychiatristThread({
      memoryId: "memory-reader",
      fetch: async () => jsonResponse({
        active_turn: null,
        content_hash: "sha256:source",
        future_thread_field: { enabled: true },
        lang_code: null,
        memory_id: "memory-reader",
        pairs: [
          {
            assistant_response: {
              completed_at: "2026-07-17T00:00:01.000Z",
              content: "A cited answer.",
              future_assistant_field: true,
              source_citations: [
                {
                  future_citation_field: "preserved",
                  source_id: "source-reader",
                  title: "Reader source",
                  url: "https://example.com/source",
                },
              ],
            },
            future_pair_field: 1,
            pair_id: "pair-reader",
            status: "completed",
            turn_id: "turn-reader",
            user_prompt: {
              content: "What changed?",
              created_at: "2026-07-17T00:00:00.000Z",
              future_prompt_field: null,
            },
          },
        ],
        status: "ready",
        thread_id: "thread-reader",
        variant_kind: "source",
      }),
    });

    expect(thread.thread_id).toBe("thread-reader");
    expect(thread.pairs[0]?.assistant_response?.source_citations[0]?.source_id)
      .toBe("source-reader");
  });

  it("rejects a malformed nested thread response with its actual 2xx status", async () => {
    await expect(createPsychiatristThread({
      memoryId: "memory-reader",
      fetch: async () => jsonResponseWithStatus({
        active_turn: null,
        content_hash: "sha256:source",
        lang_code: null,
        memory_id: "memory-reader",
        pairs: [
          {
            assistant_response: {
              completed_at: "2026-07-17T00:00:01.000Z",
              content: "A cited answer.",
              source_citations: [
                {
                  source_id: "",
                  title: "Reader source",
                  url: "https://example.com/source",
                },
              ],
            },
            pair_id: "pair-reader",
            status: "completed",
            turn_id: "turn-reader",
            user_prompt: {
              content: "What changed?",
              created_at: "2026-07-17T00:00:00.000Z",
            },
          },
        ],
        status: "ready",
        thread_id: "thread-reader",
        variant_kind: "source",
      }, 201),
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist thread response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 201,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects a thread response outside the requested reader scope", async () => {
    await expect(createPsychiatristThread({
      langCode: "ja-JP",
      memoryId: "memory-reader",
      fetch: async () => jsonResponseWithStatus({
        active_turn: null,
        content_hash: "sha256:source",
        lang_code: null,
        memory_id: "memory-other",
        pairs: [],
        status: "ready",
        thread_id: "thread-reader",
        variant_kind: "source",
      }, 202),
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist thread response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 202,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects invalid JSON from a successful send response", async () => {
    await expect(sendPsychiatristMessage({
      fetch: async () => new Response("not-json", {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
      memoryId: "memory-reader",
      message: "What changed?",
      threadId: "thread-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist message response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 202,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects malformed successful send response URLs", async () => {
    await expect(sendPsychiatristMessage({
      fetch: async () => jsonResponseWithStatus({
        event_url: "",
        pair_id: "pair-reader",
        replay_url: "/events/replay",
        status: "started",
        thread_id: "thread-reader",
        turn_id: "turn-reader",
      }, 202),
      memoryId: "memory-reader",
      message: "What changed?",
      threadId: "thread-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist message response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 202,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects an empty successful regenerate response", async () => {
    await expect(regeneratePsychiatristResponse({
      fetch: async () => new Response(null, { status: 204 }),
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist regenerate response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 204,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects a regenerate response outside the requested pair scope", async () => {
    await expect(regeneratePsychiatristResponse({
      fetch: async () => jsonResponseWithStatus({
        event_url: "/events/live",
        pair_id: "pair-other",
        replay_url: "/events/replay",
        status: "started",
        thread_id: "thread-reader",
        turn_id: "turn-reader",
      }, 202),
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist regenerate response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 202,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects malformed successful cancel payloads at the browser boundary", async () => {
    await expect(cancelPsychiatristTurn({
      fetch: async () => jsonResponse({
        status: "canceling",
        turn_id: "turn-reader",
      }),
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      turnId: "turn-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      code: "request_failed",
      name: "PsychiatristRequestError",
      responseStatus: 200,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("rejects a cancel result for a different turn generation", async () => {
    await expect(cancelPsychiatristTurn({
      fetch: async () => jsonResponse({
        status: "canceled",
        turn_id: "turn-stale",
      }),
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      turnId: "turn-current",
      variantKind: "source",
    })).rejects.toMatchObject({
      code: "request_failed",
      name: "PsychiatristRequestError",
      responseStatus: 200,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("preserves cancel invalid-JSON parsing behavior", async () => {
    await expect(cancelPsychiatristTurn({
      fetch: async () => new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      turnId: "turn-reader",
      variantKind: "source",
    })).rejects.toBeInstanceOf(SyntaxError);
  });

  it("preserves cancel empty-success invalid response behavior", async () => {
    await expect(cancelPsychiatristTurn({
      fetch: async () => new Response(null, { status: 204 }),
      memoryId: "memory-reader",
      pairId: "pair-reader",
      threadId: "thread-reader",
      turnId: "turn-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist cancel response was invalid.",
      name: "PsychiatristRequestError",
      responseStatus: 200,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it.each(["canceled", "completed", "failed"] as const)(
    "accepts a typed %s cancel result for the requested turn",
    async (status) => {
      await expect(cancelPsychiatristTurn({
        fetch: async () => jsonResponse({
          status,
          turn_id: "turn-reader",
        }),
        memoryId: "memory-reader",
        pairId: "pair-reader",
        threadId: "thread-reader",
        turnId: "turn-reader",
        variantKind: "source",
      })).resolves.toEqual({
        status,
        turn_id: "turn-reader",
      });
    },
  );

  it("creates a running transcript pair immediately after a send starts", () => {
    const sendIndex = dockSource.indexOf("const started = await sendPsychiatristMessage");
    const pairIndex = dockSource.indexOf("setTranscriptPairs((current) => [", sendIndex);
    const promptIndex = dockSource.indexOf("userPrompt: message", pairIndex);

    expect(sendIndex).toBeGreaterThan(-1);
    expect(pairIndex).toBeGreaterThan(sendIndex);
    expect(promptIndex).toBeGreaterThan(pairIndex);
  });

  it("preserves structured stale-thread errors for reader recovery", async () => {
    await expect(sendPsychiatristMessage({
      fetch: async () => new Response(JSON.stringify({
        action: "refresh_thread",
        code: "thread_stale",
        message: "The psychiatrist thread is stale. Refresh the reader thread before retrying.",
        status: "error",
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
      memoryId: "memory-reader",
      message: "What changed?",
      threadId: "thread-reader",
      variantKind: "source",
    })).rejects.toMatchObject({
      action: "refresh_thread",
      code: "thread_stale",
      message: "The psychiatrist thread is stale. Refresh the reader thread before retrying.",
      name: "PsychiatristRequestError",
      responseStatus: 409,
    } satisfies Partial<PsychiatristRequestError>);
  });

  it("maps structured API failures to safe reader messages", () => {
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "setup_codex_auth",
      code: "auth_required",
      message: "raw auth path /Users/example/.codex/auth.json",
      responseStatus: 401,
    }))).toBe("Set up Codex auth before using Psychiatrist.");
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "retry",
      code: "runtime_isolation_required",
      message: "raw isolation details /Users/example/project",
      responseStatus: 503,
    }))).toBe("Configure the required isolated Codex runtime before using Psychiatrist.");
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "retry",
      code: "context_overflow",
      message: "raw markdown <memory_section_untrusted>",
      responseStatus: 413,
    }))).toBe("This memory is too large for the current assistant context.");
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "allow_web_sources",
      code: "network_permission_required",
      message: "fetch https://example.com with token secret",
      responseStatus: 409,
    }))).toBe("Allow web search/source lookup for this answer to continue.");
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "retry",
      code: "turn_not_ready",
      message: "stop failed while active turn metadata is settling",
      responseStatus: 409,
    }))).toBe("Psychiatrist turn is still starting. Retry Stop after the turn is ready.");
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "retry",
      code: "event_limit_exceeded",
      message: "raw oversized event details with secret path /private/tmp/turn",
      responseStatus: 500,
    }))).toBe("Psychiatrist could not finish. Retry when ready.");
    expect(getPsychiatristErrorMessage(new PsychiatristRequestError({
      action: "retry",
      code: "unknown",
      message: "socket /private/tmp/app-server.sock token abc",
      responseStatus: 500,
    }))).toBe("Psychiatrist request failed.");
  });

  it("refreshes a stale reader thread without dropping the unsent prompt", () => {
    const sendIndex = dockSource.indexOf("const started = await sendPsychiatristMessage");
    const clearIndex = dockSource.indexOf("setPrompt(\"\")", sendIndex);
    const staleIndex = dockSource.indexOf("error.code === \"thread_stale\"");
    const refreshIndex = dockSource.indexOf("await loadThread()", staleIndex);

    expect(sendIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(sendIndex);
    expect(dockSource).toContain("error instanceof PsychiatristRequestError");
    expect(staleIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(staleIndex);
    expect(dockSource).toContain("Psychiatrist thread was refreshed. Send again.");
  });

  it("refreshes stale regenerate requests and surfaces stop retry errors", () => {
    const regenerateIndex = dockSource.indexOf("const started = await regeneratePsychiatristResponse");
    const regenerateStaleIndex = dockSource.indexOf("error.code === \"thread_stale\"", regenerateIndex);
    const regenerateRefreshIndex = dockSource.indexOf("await loadThread()", regenerateStaleIndex);
    const stopIndex = dockSource.indexOf("const handleStop = async () =>");
    const stopCatchIndex = dockSource.indexOf("catch (error)", stopIndex);
    const stopErrorIndex = dockSource.indexOf("const errorText = getPsychiatristErrorMessage(error)", stopCatchIndex);

    expect(regenerateIndex).toBeGreaterThan(-1);
    expect(regenerateStaleIndex).toBeGreaterThan(regenerateIndex);
    expect(regenerateRefreshIndex).toBeGreaterThan(regenerateStaleIndex);
    expect(stopIndex).toBeGreaterThan(-1);
    expect(stopCatchIndex).toBeGreaterThan(stopIndex);
    expect(stopErrorIndex).toBeGreaterThan(stopCatchIndex);
  });

  it("surfaces safe messages from streamed answer failures", () => {
    const streamIndex = dockSource.indexOf("const handleStreamEvent = (");
    const failedIndex = dockSource.indexOf("event.type === \"psychiatrist.answer.failed\"", streamIndex);
    const errorIndex = dockSource.indexOf("const errorText = getStreamErrorMessage(event.data)", failedIndex);

    expect(streamIndex).toBeGreaterThan(-1);
    expect(failedIndex).toBeGreaterThan(streamIndex);
    expect(errorIndex).toBeGreaterThan(failedIndex);
  });

  it("models thread readiness and turn phases explicitly", () => {
    expect(dockSource).toContain(
      'type PsychiatristThreadLoadState = "idle" | "loading" | "ready" | "error"',
    );
    expect(dockSource).toContain(
      'type PsychiatristTurnPhase = "idle" | "starting" | "running" | "stopping"',
    );
    expect(dockSource).toContain('setTurnPhase("starting")');
    expect(dockSource).toContain('setTurnPhase("running")');
    expect(dockSource).toContain('setTurnPhase("stopping")');
    expect(dockSource).toContain('threadLoadState() !== "ready" || isBusy()');
    expect(dockSource).toContain("Retry thread load");
  });

  it("keeps asynchronous status scoped to one atomic live region", () => {
    expect(dockSource).toContain('aria-live="polite"');
    expect(dockSource).toContain('aria-atomic="true"');
    expect(dockSource).toContain('role="status"');
    expect(dockSource).toContain("{liveStatusMessage()}");
    expect(dockSource).not.toContain("setLiveStatusMessage(processText)");
    expect(dockSource).not.toContain("setLiveStatusMessage(response())");
  });

  it("native-disables Regenerate while any turn phase is busy", () => {
    const regenerateIndex = dockSource.indexOf(">\n                          Regenerate\n");
    const buttonIndex = dockSource.lastIndexOf("<button", regenerateIndex);
    const disabledIndex = dockSource.indexOf("disabled={isBusy()}", buttonIndex);

    expect(regenerateIndex).toBeGreaterThan(-1);
    expect(disabledIndex).toBeGreaterThan(buttonIndex);
    expect(disabledIndex).toBeLessThan(regenerateIndex);
  });

  it("closes EventSource connections on lifecycle cleanup without canceling turns", () => {
    expect(dockSource).toContain("let disconnectPsychiatristStream");
    expect(dockSource).toContain("disconnectPsychiatristStream?.()");
    expect(dockSource).toContain("disconnectPsychiatristStream = connectPsychiatristStream");
    expect(dockSource).toContain("return () => eventSource.close()");
    expect(dockSource).not.toContain("onCleanup(() => {\n      void handleStop()");
  });

  it("converts stored pairs and appends safe process plus answer stream deltas", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-reader",
        status: "pending",
        turn_id: "turn-reader",
        user_prompt: {
          content: "What changed?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const withProcess = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { text: "Reading the active memory." },
      type: "psychiatrist.process.delta",
    }));
    const withHiddenProcess = applyPsychiatristStreamEvent(withProcess, streamEvent({
      data: { text: "hidden reasoning: chain-of-thought" },
      type: "psychiatrist.process.delta",
    }));
    const withAnswer = applyPsychiatristStreamEvent(withHiddenProcess, streamEvent({
      data: { text: "The answer." },
      type: "psychiatrist.answer.delta",
    }));
    const completed = applyPsychiatristStreamEvent(withAnswer, streamEvent({
      data: {
        pair_id: "pair-reader",
        source_citations: [
          {
            source_id: "source-live",
            title: "Live source",
            url: "https://example.com/live",
          },
        ],
      },
      type: "psychiatrist.answer.completed",
    }));

    expect(completed).toEqual([
      {
        answer: "The answer.",
        citations: [
          {
            source_id: "source-live",
            title: "Live source",
            url: "https://example.com/live",
          },
        ],
        pairId: "pair-reader",
        process: ["Reading the active memory."],
        status: "completed",
        turnId: "turn-reader",
        userPrompt: "What changed?",
      },
    ]);
  });

  it("applies final answer text from completion events when no delta was streamed", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-reader",
        status: "pending",
        turn_id: "turn-reader",
        user_prompt: {
          content: "What changed?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    const completed = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: {
        pair_id: "pair-reader",
        source_citations: [],
        text: "Final answer without deltas.",
      },
      type: "psychiatrist.answer.completed",
    }));

    expect(completed[0]).toMatchObject({
      answer: "Final answer without deltas.",
      status: "completed",
      turnId: "turn-reader",
    });
  });

  it("preserves stored source citations in transcript pairs", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Cited answer.",
          source_citations: [
            {
              source_id: "source-1",
              title: "Release notes",
              url: "https://example.com/releases",
            },
          ],
        },
        pair_id: "pair-cited",
        status: "completed",
        turn_id: "turn-cited",
        user_prompt: {
          content: "Need source?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    expect(transcript[0]?.citations).toEqual([
      {
        source_id: "source-1",
        title: "Release notes",
        url: "https://example.com/releases",
      },
    ]);
  });

  it("preserves persisted web-source retry actions in transcript pairs", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-network",
        retry_action: "allow_web_sources",
        retry_mode: "first_answer",
        retry_turn_id: "turn-network",
        status: "failed",
        turn_id: "turn-network",
        user_prompt: {
          content: "Need current source?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    expect(transcript[0]).toMatchObject({
      pairId: "pair-network",
      retryAction: "allow_web_sources",
      retryMode: "first_answer",
      retryTurnId: "turn-network",
      status: "failed",
      turnId: "turn-network",
      userPrompt: "Need current source?",
    });
  });

  it("does not apply process redaction rules to answer deltas", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-answer",
        status: "pending",
        turn_id: "turn-answer",
        user_prompt: {
          content: "What does it mention?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    const withAnswer = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { text: "The memory mentions token rotation." },
      turnId: "turn-answer",
      type: "psychiatrist.answer.delta",
    }));

    expect(withAnswer[0]?.answer).toBe("The memory mentions token rotation.");
  });

  it("adds a new live pair when a started stream event arrives after send", () => {
    const transcript = applyPsychiatristStreamEvent([], streamEvent({
      data: {
        pair_id: "pair-started",
        user_prompt: "What does this memory say?",
      },
      turnId: "turn-started",
      type: "psychiatrist.turn.started",
    }));

    expect(transcript).toEqual([
      {
        answer: "",
        citations: [],
        pairId: "pair-started",
        process: [],
        status: "running",
        turnId: "turn-started",
        userPrompt: "What does this memory say?",
      },
    ]);
  });

  it("keeps regenerate draft separate until completion", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Old answer.",
          source_citations: [],
        },
        pair_id: "pair-reader",
        status: "completed",
        turn_id: "turn-reader",
        user_prompt: {
          content: "What changed?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    const regenerating = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-reader" },
      turnId: "turn-regenerate",
      type: "psychiatrist.regenerate.started",
    }));
    const withAnswer = applyPsychiatristStreamEvent(regenerating, streamEvent({
      data: { text: "New answer." },
      turnId: "turn-regenerate",
      type: "psychiatrist.answer.delta",
    }));

    expect(withAnswer).toEqual([
      {
        answer: "Old answer.",
        citations: [],
        draftAnswer: "New answer.",
        draftOriginalTurnId: "turn-reader",
        draftTurnId: "turn-regenerate",
        pairId: "pair-reader",
        process: [],
        status: "running",
        turnId: "turn-regenerate",
        userPrompt: "What changed?",
      },
    ]);
  });

  it("marks network-required stream events as failed without adding an answer", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-network",
        status: "pending",
        turn_id: "turn-network",
        user_prompt: {
          content: "Need current source?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    const networkRequired = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: {
        code: "network_permission_required",
        message: "Allow web-source access to answer this request.",
      },
      turnId: "turn-network",
      type: "psychiatrist.network.permission_required",
    }));

    expect(networkRequired[0]?.answer).toBe("");
    expect(networkRequired[0]?.status).toBe("failed");
    expect(networkRequired[0]?.turnId).toBe("turn-network");
  });

  it("clears partial answers from first-answer web-source-required turns while preserving retry metadata", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-network",
        status: "pending",
        turn_id: "turn-network",
        user_prompt: {
          content: "Need current source?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const withDelta = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { text: "I need current" },
      turnId: "turn-network",
      type: "psychiatrist.answer.delta",
    }));

    const networkRequired = applyPsychiatristStreamEvent(withDelta, streamEvent({
      data: {
        code: "network_permission_required",
        message: "Allow web-source access to answer this request.",
        retry_action: "allow_web_sources",
        retry_mode: "first_answer",
        retry_turn_id: "turn-network",
      },
      turnId: "turn-network",
      type: "psychiatrist.network.permission_required",
    }));

    expect(networkRequired[0]).toMatchObject({
      answer: "",
      retryAction: "allow_web_sources",
      retryMode: "first_answer",
      retryTurnId: "turn-network",
      status: "failed",
      turnId: "turn-network",
    });
  });

  it("clears partial answers from failed first-answer turns", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-failed",
        status: "pending",
        turn_id: "turn-failed",
        user_prompt: {
          content: "What happens?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const withDelta = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { text: "Partial answer" },
      turnId: "turn-failed",
      type: "psychiatrist.answer.delta",
    }));

    const failed = applyPsychiatristStreamEvent(withDelta, streamEvent({
      data: {
        code: "timeout",
        message: "Psychiatrist answer failed.",
        pair_id: "pair-failed",
      },
      turnId: "turn-failed",
      type: "psychiatrist.answer.failed",
    }));

    expect(failed[0]).toMatchObject({
      answer: "",
      status: "failed",
      turnId: "turn-failed",
    });
  });

  it("clears partial answers from canceled first-answer turns", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: undefined,
        pair_id: "pair-canceled",
        status: "pending",
        turn_id: "turn-canceled",
        user_prompt: {
          content: "What happens if I stop this?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const withDelta = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-canceled", text: "Partial answer" },
      turnId: "turn-canceled",
      type: "psychiatrist.answer.delta",
    }));

    const canceled = applyPsychiatristStreamEvent(withDelta, streamEvent({
      data: { pair_id: "pair-canceled" },
      turnId: "turn-canceled",
      type: "psychiatrist.turn.canceled",
    }));

    expect(canceled[0]).toMatchObject({
      answer: "",
      status: "canceled",
      turnId: "turn-canceled",
    });
  });

  it("keeps completed regenerate answers visible for regenerate web-source retries", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Old answer.",
          source_citations: [],
        },
        pair_id: "pair-regenerate",
        status: "completed",
        turn_id: "turn-original",
        user_prompt: {
          content: "Need current source?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const regenerating = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-regenerate" },
      turnId: "turn-regenerate",
      type: "psychiatrist.regenerate.started",
    }));
    const withDelta = applyPsychiatristStreamEvent(regenerating, streamEvent({
      data: { text: "Partial replacement." },
      turnId: "turn-regenerate",
      type: "psychiatrist.answer.delta",
    }));

    const networkRequired = applyPsychiatristStreamEvent(withDelta, streamEvent({
      data: {
        code: "network_permission_required",
        message: "Allow web-source access to answer this request.",
        pair_id: "pair-regenerate",
        retry_action: "allow_web_sources",
        retry_mode: "regenerate",
        retry_turn_id: "turn-regenerate",
      },
      turnId: "turn-regenerate",
      type: "psychiatrist.network.permission_required",
    }));

    expect(networkRequired[0]).toMatchObject({
      answer: "Old answer.",
      status: "completed",
      turnId: "turn-original",
    });
    expect(networkRequired[0]).not.toHaveProperty("draftAnswer");
  });

  it("keeps completed regenerate answers visible for normal streamed failures", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Old answer.",
          source_citations: [],
        },
        pair_id: "pair-regenerate",
        status: "completed",
        turn_id: "turn-original",
        user_prompt: {
          content: "Retry this?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const regenerating = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-regenerate" },
      turnId: "turn-regenerate",
      type: "psychiatrist.regenerate.started",
    }));
    const withDelta = applyPsychiatristStreamEvent(regenerating, streamEvent({
      data: { text: "Partial replacement." },
      turnId: "turn-regenerate",
      type: "psychiatrist.answer.delta",
    }));

    const failed = applyPsychiatristStreamEvent(withDelta, streamEvent({
      data: {
        code: "timeout",
        message: "Psychiatrist could not finish. Retry when ready.",
        pair_id: "pair-regenerate",
      },
      turnId: "turn-regenerate",
      type: "psychiatrist.answer.failed",
    }));

    expect(failed[0]).toMatchObject({
      answer: "Old answer.",
      status: "completed",
      turnId: "turn-original",
    });
    expect(failed[0]).not.toHaveProperty("draftAnswer");
  });

  it("keeps completed regenerate answers visible after stopped regenerate streams", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Old answer.",
          source_citations: [],
        },
        pair_id: "pair-regenerate",
        status: "completed",
        turn_id: "turn-original",
        user_prompt: {
          content: "Retry this?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const regenerating = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-regenerate" },
      turnId: "turn-regenerate",
      type: "psychiatrist.regenerate.started",
    }));
    const withDelta = applyPsychiatristStreamEvent(regenerating, streamEvent({
      data: { pair_id: "pair-regenerate", text: "Partial replacement." },
      turnId: "turn-regenerate",
      type: "psychiatrist.answer.delta",
    }));

    const stopped = applyPsychiatristStreamEvent(withDelta, streamEvent({
      data: { pair_id: "pair-regenerate" },
      turnId: "turn-regenerate",
      type: "psychiatrist.turn.canceled",
    }));

    expect(stopped[0]).toMatchObject({
      answer: "Old answer.",
      status: "completed",
      turnId: "turn-original",
    });
    expect(stopped[0]).not.toHaveProperty("draftAnswer");
  });

  it("ignores stale regenerate deltas for completed pairs", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Canonical answer.",
          source_citations: [],
        },
        pair_id: "pair-regenerate",
        status: "completed",
        turn_id: "turn-original",
        user_prompt: {
          content: "Retry this?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);

    const withStaleDelta = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-regenerate", text: "Stale draft." },
      turnId: "turn-stale-regenerate",
      type: "psychiatrist.answer.delta",
    }));

    expect(withStaleDelta[0]).toMatchObject({
      answer: "Canonical answer.",
      status: "completed",
      turnId: "turn-original",
    });
    expect(withStaleDelta[0]).not.toHaveProperty("draftAnswer");
  });

  it("clears stale retry metadata when a regenerate completes without retry metadata", () => {
    const transcript = toPsychiatristTranscriptPairs([
      {
        assistant_response: {
          completed_at: "2026-06-01T00:00:00.000Z",
          content: "Old answer.",
          source_citations: [],
        },
        pair_id: "pair-regenerate",
        retry_action: "allow_web_sources",
        retry_mode: "regenerate",
        retry_turn_id: "turn-retry",
        status: "completed",
        turn_id: "turn-original",
        user_prompt: {
          content: "Retry this?",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    const regenerating = applyPsychiatristStreamEvent(transcript, streamEvent({
      data: { pair_id: "pair-regenerate" },
      turnId: "turn-regenerate",
      type: "psychiatrist.regenerate.started",
    }));

    const completed = applyPsychiatristStreamEvent(regenerating, streamEvent({
      data: {
        pair_id: "pair-regenerate",
        text: "Approved replacement.",
      },
      turnId: "turn-regenerate",
      type: "psychiatrist.regenerate.completed",
    }));

    expect(completed[0]).toMatchObject({
      answer: "Approved replacement.",
      status: "completed",
      turnId: "turn-regenerate",
    });
    expect(completed[0]).not.toHaveProperty("retryAction");
    expect(completed[0]).not.toHaveProperty("retryMode");
    expect(completed[0]).not.toHaveProperty("retryTurnId");
  });
});

function jsonResponse(value: unknown): Response {
  return jsonResponseWithStatus(value, 200);
}

function jsonResponseWithStatus(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamEvent(input: {
  data: unknown;
  turnId?: string;
  type:
    | "psychiatrist.turn.started"
    | "psychiatrist.process.delta"
    | "psychiatrist.answer.delta"
    | "psychiatrist.answer.completed"
    | "psychiatrist.answer.failed"
    | "psychiatrist.turn.canceled"
    | "psychiatrist.network.permission_required"
    | "psychiatrist.regenerate.started"
    | "psychiatrist.regenerate.completed";
}) {
  return {
    data: input.data,
    eventId: "000000000001",
    memoryId: "memory-reader",
    threadId: "thread-reader",
    timestamp: 1,
    turnId: input.turnId ?? "turn-reader",
    type: input.type,
  };
}
