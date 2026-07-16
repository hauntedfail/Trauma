import type { APIEvent } from "@solidjs/start/server";

import {
  encodeServerSentEvent,
  isTerminalTranslationEventType,
  translationEventBus,
  type TranslationEventBus,
} from "./events";
import {
  readTranslationJobSnapshot,
  type TranslationJobSnapshot,
} from "./runner";

type ReadTranslationJobSnapshot = (input: {
  jobId: string;
}) => Promise<TranslationJobSnapshot | null>;

const TERMINAL_TRANSLATION_JOB_STATUSES = new Set([
  "canceled",
  "complete",
  "failed",
  "stale",
  "unavailable",
]);

export function createTranslationJobEventsHandler(input: {
  eventBus?: TranslationEventBus;
  heartbeatIntervalMs?: number;
  readTranslationJobSnapshot?: ReadTranslationJobSnapshot;
} = {}) {
  return async function handleTranslationJobEvents(
    event: APIEvent,
  ): Promise<Response> {
    return handleTranslationJobEventsRequest(event, input);
  };
}

export async function handleTranslationJobEventsRequest(
  event: APIEvent,
  input: {
    eventBus?: TranslationEventBus;
    heartbeatIntervalMs?: number;
    readTranslationJobSnapshot?: ReadTranslationJobSnapshot;
  } = {},
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
  let cancelStream: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      const cleanup = (): boolean => {
        if (closed) {
          return false;
        }
        closed = true;
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
        }
        unsubscribe?.();
        event.request.signal.removeEventListener("abort", close);
        return true;
      };
      const close = () => {
        if (!cleanup()) {
          return;
        }
        controller.close();
      };
      cancelStream = () => {
        cleanup();
      };
      const send = (message: string) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(message));
      };
      event.request.signal.addEventListener("abort", close, { once: true });
      if (event.request.signal.aborted) {
        close();
        return;
      }

      const subscription = eventBus.subscribeWithReplay(
        jobId,
        (translationEvent) => {
          send(encodeServerSentEvent(translationEvent));
          if (isTerminalTranslationEventType(translationEvent.type)) {
            close();
          }
        },
      );
      unsubscribe = subscription.unsubscribe;

      send(encodeSnapshotServerSentEvent(snapshot));
      for (const replayed of subscription.replay) {
        send(encodeServerSentEvent(replayed));
        if (isTerminalTranslationEventType(replayed.type)) {
          close();
          return;
        }
      }
      if (TERMINAL_TRANSLATION_JOB_STATUSES.has(snapshot.status)) {
        close();
        return;
      }

      if (event.request.signal.aborted) {
        close();
        return;
      }
      const refreshedSnapshot = await readSnapshot({ jobId });
      if (closed || event.request.signal.aborted) {
        close();
        return;
      }
      if (refreshedSnapshot === null) {
        close();
        return;
      }
      if (
        TERMINAL_TRANSLATION_JOB_STATUSES.has(refreshedSnapshot.status)
      ) {
        send(encodeSnapshotServerSentEvent(refreshedSnapshot));
        close();
        return;
      }

      heartbeat = setInterval(() => send(": keep-alive\n\n"), heartbeatIntervalMs);
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
