import type { CodexAppServerEvent } from "../translation/codex-app-server";

export const PSYCHIATRIST_EVENT_LIMITS = Object.freeze({
  maxDeltaBytes: 64 * 1_024,
  maxFinalAnswerBytes: 2 * 1_024 * 1_024,
  maxPendingBytes: 1 * 1_024 * 1_024,
  maxPendingEvents: 128,
  maxSsePendingBytes: 3 * 1_024 * 1_024,
  maxSsePendingEvents: 128,
  maxStreamBytes: 8 * 1_024 * 1_024,
  maxStreamRows: 4_100,
  maxTurnBytes: 4 * 1_024 * 1_024,
  maxTurnEvents: 4_096,
});

export interface PsychiatristEventPersistenceLimits {
  maxEventBytes: number;
  maxPendingBytes: number;
  maxPendingEvents: number;
  maxTurnBytes: number;
  maxTurnEvents: number;
}

export interface PsychiatristTurnLimits {
  eventPersistence: PsychiatristEventPersistenceLimits;
  maxFinalAnswerBytes: number;
}

export interface PsychiatristStreamLimits {
  maxDeltaBytes: number;
  maxFinalAnswerBytes: number;
  maxStreamBytes: number;
  maxStreamRows: number;
}

export interface PsychiatristSseLimits {
  maxPendingBytes: number;
  maxPendingEvents: number;
}

export const PSYCHIATRIST_TURN_LIMITS: PsychiatristTurnLimits = Object.freeze({
  eventPersistence: Object.freeze({
    maxEventBytes: PSYCHIATRIST_EVENT_LIMITS.maxDeltaBytes,
    maxPendingBytes: PSYCHIATRIST_EVENT_LIMITS.maxPendingBytes,
    maxPendingEvents: PSYCHIATRIST_EVENT_LIMITS.maxPendingEvents,
    maxTurnBytes: PSYCHIATRIST_EVENT_LIMITS.maxTurnBytes,
    maxTurnEvents: PSYCHIATRIST_EVENT_LIMITS.maxTurnEvents,
  }),
  maxFinalAnswerBytes: PSYCHIATRIST_EVENT_LIMITS.maxFinalAnswerBytes,
});

export const PSYCHIATRIST_STREAM_LIMITS: PsychiatristStreamLimits = Object.freeze({
  maxDeltaBytes: PSYCHIATRIST_EVENT_LIMITS.maxDeltaBytes,
  maxFinalAnswerBytes: PSYCHIATRIST_EVENT_LIMITS.maxFinalAnswerBytes,
  maxStreamBytes: PSYCHIATRIST_EVENT_LIMITS.maxStreamBytes,
  maxStreamRows: PSYCHIATRIST_EVENT_LIMITS.maxStreamRows,
});

export const PSYCHIATRIST_SSE_LIMITS: PsychiatristSseLimits = Object.freeze({
  maxPendingBytes: PSYCHIATRIST_EVENT_LIMITS.maxSsePendingBytes,
  maxPendingEvents: PSYCHIATRIST_EVENT_LIMITS.maxSsePendingEvents,
});

export type PsychiatristEventLimitKind =
  | "event_bytes"
  | "final_answer_bytes"
  | "pending_bytes"
  | "pending_events"
  | "sse_pending_bytes"
  | "sse_pending_events"
  | "stream_bytes"
  | "stream_rows"
  | "turn_bytes"
  | "turn_events";

export class PsychiatristEventLimitError extends Error {
  readonly code = "event_limit_exceeded";

  constructor(
    public readonly kind: PsychiatristEventLimitKind,
    message = "Psychiatrist event limit exceeded.",
  ) {
    super(message);
    this.name = "PsychiatristEventLimitError";
  }
}

export function measurePsychiatristCodexEventBytes(
  event: CodexAppServerEvent,
): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

export function assertPsychiatristFinalAnswerWithinLimit(
  answer: string,
  maximum = PSYCHIATRIST_EVENT_LIMITS.maxFinalAnswerBytes,
): void {
  if (Buffer.byteLength(answer, "utf8") > maximum) {
    throw new PsychiatristEventLimitError(
      "final_answer_bytes",
      "Psychiatrist final answer exceeded the supported byte limit.",
    );
  }
}

export function assertPsychiatristDeltaWithinLimit(
  delta: string,
  maximum = PSYCHIATRIST_EVENT_LIMITS.maxDeltaBytes,
): void {
  if (Buffer.byteLength(delta, "utf8") > maximum) {
    throw new PsychiatristEventLimitError(
      "event_bytes",
      "Psychiatrist answer delta exceeded the supported byte limit.",
    );
  }
}
