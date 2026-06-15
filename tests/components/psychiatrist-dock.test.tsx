import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  findPersistedWebSourceRetryPair,
  PsychiatristDock,
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

  it("keeps the dock source wired for keyboard close, stop, regenerate, and reduced motion", () => {
    expect(dockSource).toContain("Escape");
    expect(dockSource).toContain("handleStop");
    expect(dockSource).toContain("cancelPsychiatristTurn");
    expect(dockSource).toContain("regeneratePsychiatristResponse");
    expect(dockSource).toContain("prefers-reduced-motion");
    expect(dockSource).toContain("shiftKey");
    expect(dockSource).toContain("Enter");
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

  it("resets loaded psychiatrist state when the active reader memory changes", () => {
    expect(dockSource).toContain("createEffect");
    expect(dockSource).toContain("readReaderThreadKey(props.memoryId, props.langCode)");
    expect(dockSource).toContain("resetThreadStateForMemoryChange");
    expect(dockSource).toContain("if (isOpen())");
    expect(dockSource).toContain("void loadThread()");
  });

  it("scopes Enter submit handling to the prompt textarea", () => {
    expect(dockSource).toContain("event.target === inputRef");
    expect(dockSource).toContain("event.preventDefault()");
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
        return new Response(null, { status: 204 });
      }
      return jsonResponse({
        event_url: "/api/psychiatrist-turns/turn-reader/events",
        pair_id: "pair-reader",
        replay_url: "/api/psychiatrist-turns/turn-reader/events",
        status: "started",
        thread_id: "thread-reader",
        turn_id: "turn-reader",
      });
    };

    await sendPsychiatristMessage({
      clientMessageId: "local-1",
      fetch,
      message: "What is the risk?",
      threadId: "thread-reader",
    });
    await cancelPsychiatristTurn({ fetch, turnId: "turn-reader" });
    await regeneratePsychiatristResponse({ fetch, pairId: "pair-reader" });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/psychiatrist-threads/thread-reader/messages", "POST"],
      ["http://localhost/api/psychiatrist-turns/turn-reader/cancel", "POST"],
      ["http://localhost/api/psychiatrist-pairs/pair-reader/regenerate", "POST"],
    ]);
    await expect(requests[0]?.json()).resolves.toEqual({
      client_message_id: "local-1",
      message: "What is the risk?",
      web_source_permission: "deny",
    });
    await expect(requests[2]?.json()).resolves.toEqual({
      web_source_permission: "deny",
    });
  });

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
      clientMessageId: "local-1",
      fetch: async () => new Response(JSON.stringify({
        action: "refresh_thread",
        code: "thread_stale",
        message: "The psychiatrist thread is stale. Refresh the reader thread before retrying.",
        status: "error",
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
      message: "What changed?",
      threadId: "thread-reader",
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
    const stopErrorIndex = dockSource.indexOf("setErrorMessage(getPsychiatristErrorMessage(error))", stopCatchIndex);

    expect(regenerateIndex).toBeGreaterThan(-1);
    expect(regenerateStaleIndex).toBeGreaterThan(regenerateIndex);
    expect(regenerateRefreshIndex).toBeGreaterThan(regenerateStaleIndex);
    expect(stopIndex).toBeGreaterThan(-1);
    expect(stopCatchIndex).toBeGreaterThan(stopIndex);
    expect(stopErrorIndex).toBeGreaterThan(stopCatchIndex);
  });

  it("surfaces safe messages from streamed answer failures", () => {
    const streamIndex = dockSource.indexOf("const handleStreamEvent = (event: PsychiatristStreamEvent) =>");
    const failedIndex = dockSource.indexOf("event.type === \"psychiatrist.answer.failed\"", streamIndex);
    const errorIndex = dockSource.indexOf("setErrorMessage(getStreamErrorMessage(event.data))", failedIndex);

    expect(streamIndex).toBeGreaterThan(-1);
    expect(failedIndex).toBeGreaterThan(streamIndex);
    expect(errorIndex).toBeGreaterThan(failedIndex);
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

  it("keeps streamed web-source-required turns failed even after deltas", () => {
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
      },
      turnId: "turn-network",
      type: "psychiatrist.network.permission_required",
    }));

    expect(networkRequired[0]).toMatchObject({
      answer: "I need current",
      status: "failed",
      turnId: "turn-network",
    });
  });

  it("keeps fresh failed turns failed after streamed answer deltas", () => {
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
      answer: "Partial answer",
      status: "failed",
      turnId: "turn-failed",
    });
  });

  it("keeps canceled first-answer turns canceled after streamed answer deltas", () => {
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
      answer: "Partial answer",
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
  return new Response(JSON.stringify(value), {
    status: 200,
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
