import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { PsychiatristDock } from "../../src/components/reader/PsychiatristDock";
import {
  cancelPsychiatristTurn,
  createPsychiatristThread,
  regeneratePsychiatristResponse,
  sendPsychiatristMessage,
} from "../../src/components/reader/psychiatrist-requests";

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
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
