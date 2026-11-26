import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

import {
  buildReaderMarginNoteAskPayload,
  connectReaderMarginNoteStream,
  createInitialMarginNoteState,
  formatMarginNoteActionLabel,
  formatMarginNotePassageSnippet,
  MARGIN_NOTE_MAX_PROMPT_CHARS,
  MARGIN_NOTE_MAX_SELECTED_TEXT_CHARS,
  ReaderMarginNoteCard,
  reduceMarginNoteStreamEvent,
  submitReaderMarginNoteAsk,
  type EventSourceLike,
} from "../../src/components/reader/ReaderMarginNoteCard";
import type { PsychiatristStreamEvent } from "../../src/components/reader/psychiatrist-types";

const marginNoteSource = readFileSync(
  "src/components/reader/ReaderMarginNoteCard.tsx",
  "utf8",
);
const memoryReaderSource = readFileSync(
  "src/components/reader/MemoryReader.tsx",
  "utf8",
);
const tailwindSource = readFileSync("src/styles/tailwind.css", "utf8");

describe("reader in-situ margin note card (D12)", () => {
  it("builds Simplify, Explain, and Ask payloads with grounded passage context (AC 14)", () => {
    expect(
      buildReaderMarginNoteAskPayload({
        action: "simplify",
        selectedText: "  Cognitive load theory distinguishes intrinsic load.  ",
        sectionAnchor: "cognitive-load",
        sectionTitle: "Cognitive Load",
      }),
    ).toEqual({
      action: "simplify",
      selectedText: "Cognitive load theory distinguishes intrinsic load.",
      sectionAnchor: "cognitive-load",
      sectionTitle: "Cognitive Load",
      resumeLatest: true,
    });

    expect(
      buildReaderMarginNoteAskPayload({
        action: "explain",
        selectedText: "Split-attention effect",
        langCode: "ja-JP",
      }),
    ).toEqual({
      action: "explain",
      selectedText: "Split-attention effect",
      langCode: "ja-JP",
      resumeLatest: true,
    });

    expect(
      buildReaderMarginNoteAskPayload({
        action: "ask",
        selectedText: "Working memory capacity",
        sectionAnchor: "wm",
        sectionTitle: "Working Memory",
        prompt: "  Why does this matter for ADHD readers?  ",
      }),
    ).toEqual({
      action: "ask",
      selectedText: "Working memory capacity",
      sectionAnchor: "wm",
      sectionTitle: "Working Memory",
      prompt: "Why does this matter for ADHD readers?",
      resumeLatest: true,
    });

    expect(() =>
      buildReaderMarginNoteAskPayload({
        action: "ask",
        selectedText: "Working memory capacity",
        prompt: "   ",
      }),
    ).toThrow(/Prompt is required/);

    const capped = buildReaderMarginNoteAskPayload({
      action: "ask",
      selectedText: "a".repeat(MARGIN_NOTE_MAX_SELECTED_TEXT_CHARS + 50),
      prompt: "b".repeat(MARGIN_NOTE_MAX_PROMPT_CHARS + 50),
    });
    expect((capped.selectedText as string).length).toBe(
      MARGIN_NOTE_MAX_SELECTED_TEXT_CHARS,
    );
    expect((capped.prompt as string).length).toBe(MARGIN_NOTE_MAX_PROMPT_CHARS);
  });

  it("formats action labels and passage snippets cleanly", () => {
    expect(formatMarginNoteActionLabel("simplify")).toBe("Simplified");
    expect(formatMarginNoteActionLabel("explain")).toBe("Explained");
    expect(formatMarginNoteActionLabel("ask")).toBe("Answer");

    expect(
      formatMarginNotePassageSnippet("  Line one\n\n  line two  ", 40),
    ).toBe("Line one line two");
    expect(
      formatMarginNotePassageSnippet("A very long passage ".repeat(20), 24),
    ).toBe("A very long passage A v…");
  });

  it("transitions SSE streaming state across delta, completion, failure, cancel, and network permission events", () => {
    const initialInput = createInitialMarginNoteState("ask", false);
    expect(initialInput.phase).toBe("input");

    let state = createInitialMarginNoteState("simplify", false);
    expect(state.phase).toBe("submitting");

    const baseEvent = {
      eventId: "evt-1",
      memoryId: "mem-1",
      threadId: "thread-1",
      timestamp: 1_700_000_000_000,
      turnId: "turn-1",
    };

    state = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.turn.started",
      data: { pair_id: "pair-1", status: "running" },
    });
    expect(state.phase).toBe("streaming");

    state = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.process.delta",
      data: { text: "Reading passage…" },
    });
    expect(state.statusText).toBe("Reading passage…");

    state = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.answer.delta",
      data: { text: "In plain terms, " },
    });
    state = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.answer.delta",
      data: { text: "keep context close." },
    });
    expect(state.phase).toBe("streaming");
    expect(state.answer).toBe("In plain terms, keep context close.");
    expect(state.statusText).toBe("");

    const completed = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.answer.completed",
      data: {
        pair_id: "pair-1",
        text: "In plain terms, keep context close.",
      },
    });
    expect(completed.phase).toBe("completed");
    expect(completed.answer).toBe("In plain terms, keep context close.");

    const failed = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.answer.failed",
      data: {
        code: "provider_unavailable",
        message: "Model backend is offline.",
      },
    });
    expect(failed.phase).toBe("error");
    expect(failed.errorMessage).toBe("Model backend is offline.");

    const canceled = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.turn.canceled",
      data: { code: "user_canceled", status: "canceled" },
    });
    expect(canceled.phase).toBe("error");
    expect(canceled.errorMessage).toBe("Request was canceled.");

    const networkPerm = reduceMarginNoteStreamEvent(state, {
      ...baseEvent,
      type: "psychiatrist.network.permission_required",
      data: {
        code: "network_permission_required",
        pair_id: "pair-1",
        retry_action: "allow_web_sources",
        retry_mode: "first_answer",
        retry_turn_id: "turn-1",
        user_prompt: "Check latest paper",
        message: "Web sources are disabled for this turn.",
      },
    });
    expect(networkPerm.phase).toBe("error");
    expect(networkPerm.errorMessage).toBe(
      "Web sources are disabled for this turn.",
    );
  });

  it("consumes eventsUrl SSE stream matching PsychiatristDock schema and closes on terminal events", () => {
    const mockSource = createMockEventSource();
    const received: PsychiatristStreamEvent[] = [];
    const errors: string[] = [];

    const disconnect = connectReaderMarginNoteStream({
      createEventSource: () => mockSource.source,
      eventsUrl: "/api/memories/mem-1/psychiatrist/threads/t-1/turns/turn-1/events",
      memoryId: "mem-1",
      threadId: "t-1",
      turnId: "turn-1",
      onEvent: (event) => received.push(event),
      onStreamError: (message) => errors.push(message),
    });

    mockSource.emit(
      "psychiatrist.answer.delta",
      JSON.stringify({
        eventId: "e-1",
        memoryId: "mem-1",
        threadId: "t-1",
        turnId: "turn-1",
        timestamp: 100,
        type: "psychiatrist.answer.delta",
        data: { text: "Chunk 1" },
      }),
    );

    // Mismatched turnId must be ignored by parsePsychiatristStreamEvent.
    mockSource.emit(
      "psychiatrist.answer.delta",
      JSON.stringify({
        eventId: "e-2",
        memoryId: "mem-1",
        threadId: "t-1",
        turnId: "other-turn",
        timestamp: 101,
        type: "psychiatrist.answer.delta",
        data: { text: "Ignored" },
      }),
    );

    mockSource.emit(
      "psychiatrist.answer.completed",
      JSON.stringify({
        eventId: "e-3",
        memoryId: "mem-1",
        threadId: "t-1",
        turnId: "turn-1",
        timestamp: 102,
        type: "psychiatrist.answer.completed",
        data: { pair_id: "pair-1", text: "Chunk 1 done" },
      }),
    );

    expect(received.map((e) => e.type)).toEqual([
      "psychiatrist.answer.delta",
      "psychiatrist.answer.completed",
    ]);
    expect(errors).toEqual([]);
    expect(mockSource.closeSpy).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it("surfaces a graceful stream error when EventSource closes before a terminal event", () => {
    const mockSource = createMockEventSource();
    const errors: string[] = [];

    connectReaderMarginNoteStream({
      createEventSource: () => mockSource.source,
      eventsUrl: "/api/memories/mem-1/psychiatrist/threads/t-1/turns/turn-1/events",
      memoryId: "mem-1",
      threadId: "t-1",
      turnId: "turn-1",
      onEvent: () => {},
      onStreamError: (message) => errors.push(message),
    });

    mockSource.source.readyState = 2;
    mockSource.source.onerror?.(new Event("error"));

    expect(errors).toEqual(["Connection to Psychiatrist was lost."]);
    expect(mockSource.closeSpy).toHaveBeenCalledTimes(1);
  });

  it("posts to /api/agent/v1/memories/:id/ask and handles unavailable errors gracefully", async () => {
    const requests: Request[] = [];
    const okResponse = await submitReaderMarginNoteAsk({
      memoryId: "mem/1",
      payload: buildReaderMarginNoteAskPayload({
        action: "simplify",
        selectedText: "Dense jargon",
      }),
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(
          JSON.stringify({
            threadId: "thread-1",
            turnId: "turn-1",
            pairId: "pair-1",
            eventsUrl: "/api/memories/mem%2F1/psychiatrist/threads/thread-1/turns/turn-1/events",
            groundedContext: {
              action: "simplify",
              memoryId: "mem/1",
              memoryTitle: "Test",
              domain: "example.com",
              variantKind: "source",
              langCode: null,
              sectionAnchor: null,
              sectionTitle: null,
              selectedText: "Dense jargon",
              prompt: null,
            },
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(requests[0]?.url).toBe(
      "http://localhost/api/agent/v1/memories/mem%2F1/ask",
    );
    expect(requests[0]?.method).toBe("POST");
    expect(okResponse.eventsUrl).toContain("events");

    await expect(
      submitReaderMarginNoteAsk({
        memoryId: "mem-1",
        payload: { action: "explain" },
        fetch: async () =>
          new Response(
            JSON.stringify({ error: "Psychiatrist backend is unavailable" }),
            { status: 503, headers: { "content-type": "application/json" } },
          ),
      }),
    ).rejects.toThrow("Psychiatrist backend is unavailable");
  });

  it("renders Simplify, Explain, and Ask-input states with passage snippet, Close, and Continue in Psychiatrist (AC 14)", () => {
    const simplifyHtml = renderToString(() =>
      createComponent(ReaderMarginNoteCard, {
        memoryId: "mem-1",
        request: {
          action: "simplify",
          requestId: 1,
          selectedText: "Working memory is tightly constrained.",
          sectionAnchor: "intro",
          sectionTitle: "Introduction",
        },
        onClose: () => {},
        onContinueInPsychiatrist: () => {},
      }),
    );

    expect(simplifyHtml).toContain("data-reader-margin-note");
    expect(simplifyHtml).toContain('data-margin-note-action="simplify"');
    expect(simplifyHtml).toContain(">Simplified<");
    expect(simplifyHtml).toContain("Working memory is tightly constrained.");
    expect(simplifyHtml).toContain("Introduction");
    expect(simplifyHtml).toContain("Continue in Psychiatrist");
    expect(simplifyHtml).toContain('aria-label="Close margin note"');

    const askHtml = renderToString(() =>
      createComponent(ReaderMarginNoteCard, {
        memoryId: "mem-1",
        request: {
          action: "ask",
          requestId: 2,
          selectedText: "Deictic triggers cut mental demand.",
        },
        onClose: () => {},
        onContinueInPsychiatrist: () => {},
      }),
    );

    expect(askHtml).toContain('data-margin-note-action="ask"');
    expect(askHtml).toContain('data-margin-note-phase="input"');
    expect(askHtml).toContain(">Answer<");
    expect(askHtml).toContain("data-margin-note-input");
    expect(askHtml).toContain("data-margin-note-submit");
    expect(askHtml).toContain("Continue in Psychiatrist");
  });

  it("wires Esc dismissal via dismissable-layer, selection triggers, and Psychiatrist sheet handoff without shifting the 66ch column", () => {
    expect(marginNoteSource).toContain("useDismissableLayer");
    expect(marginNoteSource).toContain('if (reason === "escape")');
    expect(marginNoteSource).toContain("props.onClose()");
    expect(marginNoteSource).not.toMatch(
      /text-slate|border-slate|bg-slate|text-blue|bg-white|yellow-/,
    );

    expect(memoryReaderSource).toContain("data-reader-selection-simplify");
    expect(memoryReaderSource).toContain("data-reader-selection-explain");
    expect(memoryReaderSource).toContain("data-reader-selection-ask");
    expect(memoryReaderSource).toContain(
      'openMarginNoteFromSelection("simplify")',
    );
    expect(memoryReaderSource).toContain(
      'openMarginNoteFromSelection("explain")',
    );
    expect(memoryReaderSource).toContain('openMarginNoteFromSelection("ask")');
    expect(memoryReaderSource).toContain("<ReaderMarginNoteCard");
    expect(memoryReaderSource).toContain(
      "onContinueInPsychiatrist={continueMarginNoteInPsychiatrist}",
    );
    expect(memoryReaderSource).toContain('id="reader-psychiatrist-sheet"');

    expect(tailwindSource).toContain(".trauma-reader-margin-note");
    expect(tailwindSource).toContain("position: fixed");
  });
});

function createMockEventSource(): {
  closeSpy: ReturnType<typeof vi.fn>;
  emit: (eventType: string, data: string) => void;
  source: EventSourceLike;
} {
  const listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  const closeSpy = vi.fn();
  const source: EventSourceLike = {
    readyState: 1,
    onerror: null,
    addEventListener: (type, listener) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    close: () => {
      source.readyState = 2;
      closeSpy();
    },
  };

  return {
    closeSpy,
    emit: (eventType, data) => {
      const list = listeners.get(eventType) ?? [];
      for (const listener of list) {
        listener({ data } as MessageEvent);
      }
    },
    source,
  };
}
