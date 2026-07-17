import { describe, expect, it } from "vitest";

import {
  parsePsychiatristStreamEvent,
  type PsychiatristStreamEventScope,
} from "../../src/components/reader/psychiatrist-stream-events";
import type {
  PsychiatristStreamEventType,
} from "../../src/components/reader/psychiatrist-types";

const scope = {
  eventType: "psychiatrist.answer.delta",
  memoryId: "memory-reader",
  threadId: "thread-reader",
  turnId: "turn-reader",
} satisfies PsychiatristStreamEventScope;

describe("Psychiatrist browser stream events", () => {
  it.each([
    [
      "psychiatrist.turn.started",
      { pair_id: "pair-reader", status: "running", user_prompt: "What changed?" },
    ],
    ["psychiatrist.process.delta", { text: "Reading the active memory." }],
    ["psychiatrist.answer.delta", { text: "The answer." }],
    [
      "psychiatrist.answer.completed",
      {
        pair_id: "pair-reader",
        source_citations: [
          {
            source_id: "source-reader",
            title: "Reader source",
            url: "https://example.com/source",
          },
        ],
        text: "The answer.",
        warning: {
          code: "backup_enqueue_failed",
          message: "The answer was saved, but backup enqueue failed.",
        },
      },
    ],
    ["psychiatrist.answer.failed", { code: "timeout" }],
    ["psychiatrist.turn.canceled", { code: "turn_canceled", status: "canceled" }],
    [
      "psychiatrist.network.permission_required",
      {
        code: "network_permission_required",
        pair_id: "pair-reader",
        retry_action: "allow_web_sources",
        retry_mode: "first_answer",
        retry_turn_id: "turn-reader",
        user_prompt: "What changed?",
      },
    ],
    ["psychiatrist.regenerate.started", { pair_id: "pair-reader", status: "running" }],
    ["psychiatrist.regenerate.completed", { pair_id: "pair-reader" }],
  ] satisfies Array<[PsychiatristStreamEventType, Record<string, unknown>]>) (
    "accepts a valid %s envelope",
    (eventType, data) => {
      const event = parsePsychiatristStreamEvent(
        JSON.stringify(streamEvent(eventType, data, {
          future_envelope_field: true,
        })),
        { ...scope, eventType },
      );

      expect(event).toMatchObject({ data, type: eventType });
    },
  );

  it("allows future fields without weakening known nested fields", () => {
    const eventType = "psychiatrist.answer.completed";
    const event = parsePsychiatristStreamEvent(
      JSON.stringify(streamEvent(eventType, {
        future_data_field: { enabled: true },
        pair_id: "pair-reader",
        source_citations: [
          {
            future_citation_field: "preserved",
            source_id: "source-reader",
            title: "Reader source",
            url: "https://example.com/source",
          },
        ],
        warning: {
          code: "backup_enqueue_failed",
          future_warning_field: 1,
        },
      })),
      { ...scope, eventType },
    );

    expect(event).toBeDefined();
  });

  it.each([
    ["invalid JSON", "not-json", scope],
    [
      "empty event id",
      JSON.stringify(streamEvent(scope.eventType, { text: "Delta" }, { eventId: "" })),
      scope,
    ],
    [
      "non-finite timestamp",
      JSON.stringify(streamEvent(scope.eventType, { text: "Delta" }, { timestamp: null })),
      scope,
    ],
    [
      "wrong memory scope",
      JSON.stringify(streamEvent(scope.eventType, { text: "Delta" }, { memoryId: "memory-other" })),
      scope,
    ],
    [
      "wrong thread scope",
      JSON.stringify(streamEvent(scope.eventType, { text: "Delta" }, { threadId: "thread-other" })),
      scope,
    ],
    [
      "wrong turn scope",
      JSON.stringify(streamEvent(scope.eventType, { text: "Delta" }, { turnId: "turn-other" })),
      scope,
    ],
    [
      "named event mismatch",
      JSON.stringify(streamEvent("psychiatrist.answer.completed", { pair_id: "pair-reader" })),
      scope,
    ],
    [
      "unknown payload type",
      JSON.stringify(streamEvent("psychiatrist.future" as PsychiatristStreamEventType, {})),
      scope,
    ],
    [
      "non-record data",
      JSON.stringify(streamEvent(scope.eventType, null)),
      scope,
    ],
  ])("rejects %s", (_label, raw, expectedScope) => {
    expect(parsePsychiatristStreamEvent(raw, expectedScope)).toBeUndefined();
  });

  it.each([
    ["psychiatrist.turn.started", { pair_id: "pair-reader" }],
    ["psychiatrist.process.delta", { text: 1 }],
    ["psychiatrist.answer.delta", {}],
    ["psychiatrist.answer.completed", { pair_id: "" }],
    ["psychiatrist.answer.completed", { pair_id: "pair-reader", source_citations: null }],
    [
      "psychiatrist.answer.completed",
      { pair_id: "pair-reader", warning: { code: 1 } },
    ],
    ["psychiatrist.answer.failed", { pair_id: "pair-reader" }],
    ["psychiatrist.answer.failed", { code: "timeout", retry_mode: "again" }],
    ["psychiatrist.turn.canceled", { code: "turn_canceled", status: "complete" }],
    [
      "psychiatrist.network.permission_required",
      {
        code: "network_permission_required",
        pair_id: "pair-reader",
        retry_action: "always_allow",
        retry_mode: "first_answer",
        retry_turn_id: "turn-reader",
        user_prompt: "What changed?",
      },
    ],
    [
      "psychiatrist.network.permission_required",
      {
        code: "network_permission_required",
        pair_id: "pair-reader",
        retry_action: "allow_web_sources",
        retry_mode: "first_answer",
        retry_turn_id: "",
        user_prompt: "What changed?",
      },
    ],
    ["psychiatrist.regenerate.started", { pair_id: "pair-reader", status: "ready" }],
    [
      "psychiatrist.regenerate.completed",
      {
        pair_id: "pair-reader",
        source_citations: [{ source_id: "", title: "Source", url: "https://example.com" }],
      },
    ],
  ] satisfies Array<[PsychiatristStreamEventType, Record<string, unknown>]>) (
    "rejects malformed data for %s",
    (eventType, data) => {
      expect(parsePsychiatristStreamEvent(
        JSON.stringify(streamEvent(eventType, data)),
        { ...scope, eventType },
      )).toBeUndefined();
    },
  );
});

function streamEvent(
  type: PsychiatristStreamEventType,
  data: unknown,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    eventId: "000000000001",
    memoryId: "memory-reader",
    threadId: "thread-reader",
    timestamp: 1,
    turnId: "turn-reader",
    type,
    ...overrides,
  };
}
