import type { APIEvent } from "@solidjs/start/server";

import {
  encodeServerSentEvent,
  isTerminalTranslationEventType,
  translationEventBus,
  type TranslationEventBus,
} from "./events";
import type { TranslationEventEnvelope } from "./types";
import {
  readTranslationJobSnapshot,
  type TranslationJobSnapshot,
} from "./runner";

type ReadTranslationJobSnapshot = (input: {
  jobId: string;
}) => Promise<TranslationJobSnapshot | null>;

export interface TranslationSseLimits {
  maxPendingBytes: number;
  maxPendingEvents: number;
}

export const TRANSLATION_SSE_LIMITS = Object.freeze({
  maxPendingBytes: 3 * 1_024 * 1_024,
  maxPendingEvents: 128,
}) satisfies TranslationSseLimits;

export class TranslationSseLimitError extends Error {
  readonly code = "event_limit_exceeded";

  constructor(
    public readonly kind: "sse_pending_bytes" | "sse_pending_events",
  ) {
    super("Translation SSE subscriber limit was exceeded.");
    this.name = "TranslationSseLimitError";
  }
}

interface TranslationJobEventsHandlerOptions {
  eventBus?: TranslationEventBus;
  heartbeatIntervalMs?: number;
  readTranslationJobSnapshot?: ReadTranslationJobSnapshot;
  sseLimits?: TranslationSseLimits;
}

const TERMINAL_TRANSLATION_JOB_STATUSES = new Set([
  "canceled",
  "complete",
  "failed",
  "stale",
  "unavailable",
]);

export function createTranslationJobEventsHandler(
  input: TranslationJobEventsHandlerOptions = {},
) {
  return async function handleTranslationJobEvents(
    event: APIEvent,
  ): Promise<Response> {
    return handleTranslationJobEventsRequest(event, input);
  };
}

export async function handleTranslationJobEventsRequest(
  event: APIEvent,
  input: TranslationJobEventsHandlerOptions = {},
): Promise<Response> {
  const jobId = event.params.jobId?.trim();
  if (jobId === undefined || jobId === "") {
    return new Response("jobId must be a non-empty string", { status: 400 });
  }

  const snapshot = await (input.readTranslationJobSnapshot ??
    readTranslationJobSnapshot)({ jobId });
  if (snapshot === null) {
    return new Response("translation job was not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const eventBus = input.eventBus ?? translationEventBus;
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? 20_000;
  const readSnapshot = input.readTranslationJobSnapshot ??
    readTranslationJobSnapshot;
  const sseLimits = input.sseLimits ?? TRANSLATION_SSE_LIMITS;
  validateSseLimits(sseLimits);
  let cancelStream: (() => void) | undefined;
  let pullStream: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      let initialSnapshotPending = true;
      let refreshFinished = false;
      let refreshStarted = false;
      let refreshedTerminalSnapshot: TranslationJobSnapshot | undefined;
      let replay: TranslationEventEnvelope[] = [];
      let replayIndex = 0;
      let liveBufferBytes = 0;
      const liveBuffer: Array<{
        bytes: Uint8Array;
        event: TranslationEventEnvelope;
      }> = [];
      let pump: (() => void) | undefined;
      const cleanup = (): boolean => {
        if (closed) {
          return false;
        }
        closed = true;
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
        }
        const unsubscribeOnce = unsubscribe;
        unsubscribe = undefined;
        unsubscribeOnce?.();
        liveBuffer.length = 0;
        liveBufferBytes = 0;
        event.request.signal.removeEventListener("abort", close);
        return true;
      };
      const close = () => {
        if (!cleanup()) {
          return;
        }
        controller.close();
      };
      const closeWithError = (error: unknown) => {
        if (!cleanup()) {
          return;
        }
        controller.error(error);
      };
      cancelStream = () => {
        cleanup();
      };
      const enqueueBytes = (bytes: Uint8Array): boolean => {
        if (bytes.byteLength > sseLimits.maxPendingBytes) {
          closeWithError(new TranslationSseLimitError("sse_pending_bytes"));
          return false;
        }
        controller.enqueue(bytes);
        return true;
      };
      const enqueueEvent = (
        eventToSend: TranslationEventEnvelope,
        bytes: Uint8Array,
      ): boolean => {
        if (!enqueueBytes(bytes)) {
          return false;
        }
        if (isTerminalTranslationEventType(eventToSend.type)) {
          close();
          return false;
        }
        return true;
      };
      const ensureHeartbeat = () => {
        if (heartbeat !== undefined || closed) {
          return;
        }
        heartbeat = setInterval(() => {
          if (
            closed ||
            !refreshFinished ||
            refreshedTerminalSnapshot !== undefined ||
            liveBuffer.length > 0 ||
            (controller.desiredSize ?? 0) <= 0
          ) {
            return;
          }
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }, heartbeatIntervalMs);
      };
      const startRefresh = () => {
        if (refreshStarted || closed) {
          return;
        }
        refreshStarted = true;
        void readSnapshot({ jobId }).then((refreshedSnapshot) => {
          if (closed) {
            return;
          }
          refreshFinished = true;
          if (refreshedSnapshot === null) {
            close();
            return;
          }
          if (TERMINAL_TRANSLATION_JOB_STATUSES.has(refreshedSnapshot.status)) {
            refreshedTerminalSnapshot = refreshedSnapshot;
          } else {
            ensureHeartbeat();
          }
          pump?.();
        }).catch(closeWithError);
      };
      pump = () => {
        if (closed || (controller.desiredSize ?? 0) <= 0) {
          return;
        }
        if (initialSnapshotPending) {
          initialSnapshotPending = false;
          enqueueBytes(encoder.encode(encodeSnapshotServerSentEvent(snapshot)));
          return;
        }
        const replayed = replay[replayIndex];
        if (replayed !== undefined) {
          replayIndex += 1;
          enqueueEvent(replayed, encoder.encode(encodeServerSentEvent(replayed)));
          return;
        }
        if (TERMINAL_TRANSLATION_JOB_STATUSES.has(snapshot.status)) {
          close();
          return;
        }
        startRefresh();
        const queued = liveBuffer.shift();
        if (queued !== undefined) {
          liveBufferBytes -= queued.bytes.byteLength;
          enqueueEvent(queued.event, queued.bytes);
          return;
        }
        if (refreshedTerminalSnapshot !== undefined) {
          const terminalSnapshot = refreshedTerminalSnapshot;
          refreshedTerminalSnapshot = undefined;
          if (enqueueBytes(
            encoder.encode(encodeSnapshotServerSentEvent(terminalSnapshot)),
          )) {
            close();
          }
          return;
        }
        if (refreshFinished) {
          ensureHeartbeat();
        }
      };
      pullStream = pump;
      const enqueueLive = (translationEvent: TranslationEventEnvelope) => {
        if (closed) {
          return;
        }
        const bytes = encoder.encode(encodeServerSentEvent(translationEvent));
        if (liveBuffer.length + 1 > sseLimits.maxPendingEvents) {
          closeWithError(new TranslationSseLimitError("sse_pending_events"));
          return;
        }
        if (liveBufferBytes + bytes.byteLength > sseLimits.maxPendingBytes) {
          closeWithError(new TranslationSseLimitError("sse_pending_bytes"));
          return;
        }
        liveBuffer.push({ bytes, event: translationEvent });
        liveBufferBytes += bytes.byteLength;
        pump?.();
      };
      event.request.signal.addEventListener("abort", close, { once: true });
      if (event.request.signal.aborted) {
        close();
        return;
      }

      const subscription = eventBus.subscribeWithReplay(
        jobId,
        enqueueLive,
      );
      unsubscribe = subscription.unsubscribe;
      replay = subscription.replay;
      pump();
    },
    pull() {
      pullStream?.();
    },
    cancel() {
      cancelStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
    status: 200,
  });
}

function encodeSnapshotServerSentEvent(snapshot: TranslationJobSnapshot): string {
  return [
    "event: translation.job.snapshot",
    `data: ${JSON.stringify({
      type: "translation.job.snapshot",
      job_id: snapshot.job_id,
      memory_id: snapshot.memory_id,
      lang_code: snapshot.lang_code,
      chunk_index: null,
      data: snapshot,
    })}`,
    "",
    "",
  ].join("\n");
}

function validateSseLimits(limits: TranslationSseLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(
        "Translation SSE limits must be positive safe integers.",
      );
    }
  }
}
