import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { activePsychiatristTurns } from "./active-turns";
import {
  loadPsychiatristStreamReplay,
  subscribePsychiatristStream,
} from "./stream-store";
import type { PsychiatristStreamEvent } from "./types";

type LoadPsychiatristStreamReplay = typeof loadPsychiatristStreamReplay;
type SubscribePsychiatristStream = typeof subscribePsychiatristStream;

export function createPsychiatristTurnEventsHandler(input: {
  config?: Pick<ResolvedTraumaConfig, "storePath">;
  loadReplay?: LoadPsychiatristStreamReplay;
  subscribe?: SubscribePsychiatristStream;
} = {}) {
  return async function psychiatristTurnEvents(event: APIEvent): Promise<Response> {
    return handlePsychiatristTurnEventsRequest(event, input);
  };
}

export async function handlePsychiatristTurnEventsRequest(
  event: APIEvent,
  input: {
    config?: Pick<ResolvedTraumaConfig, "storePath">;
    loadReplay?: LoadPsychiatristStreamReplay;
    subscribe?: SubscribePsychiatristStream;
  } = {},
): Promise<Response> {
  const turnId = event.params.turnId?.trim();
  if (turnId === undefined || turnId === "") {
    return new Response("turnId must be a non-empty string", { status: 400 });
  }
  const afterEventId =
    new URL(event.request.url).searchParams.get("after_event_id") ??
    event.request.headers.get("Last-Event-ID") ??
    undefined;
  const config = input.config ?? loadRuntimeTraumaConfig();
  const loadReplay = input.loadReplay ?? loadPsychiatristStreamReplay;
  const subscribe = input.subscribe ?? subscribePsychiatristStream;
  const isLiveTurn = activePsychiatristTurns.getByTurnId(turnId) !== undefined;
  const body = isLiveTurn
    ? createLiveEventStream({ afterEventId, config, loadReplay, subscribe, turnId })
    : (await loadReplay({
      afterEventId,
      config,
      turnId,
    })).map(encodePsychiatristServerSentEvent).join("");
  return new Response(body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
    status: 200,
  });
}

function createLiveEventStream(input: {
  afterEventId?: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  loadReplay: LoadPsychiatristStreamReplay;
  subscribe: SubscribePsychiatristStream;
  turnId: string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  return new ReadableStream({
    async start(controller) {
      let closed = false;
      let replaying = true;
      const liveBuffer: PsychiatristStreamEvent[] = [];
      const sentEventIds = new Set<string>();
      const enqueueNow = (event: PsychiatristStreamEvent) => {
        if (input.afterEventId !== undefined && event.eventId <= input.afterEventId) {
          return;
        }
        if (closed || sentEventIds.has(event.eventId)) {
          return;
        }
        sentEventIds.add(event.eventId);
        controller.enqueue(encoder.encode(encodePsychiatristServerSentEvent(event)));
        if (isTerminalEvent(event)) {
          closed = true;
          unsubscribe?.();
          controller.close();
        }
      };
      const enqueue = (event: PsychiatristStreamEvent) => {
        if (replaying) {
          liveBuffer.push(event);
          return;
        }
        enqueueNow(event);
      };
      unsubscribe = input.subscribe({
        onEvent: enqueue,
        turnId: input.turnId,
      });
      let replay: PsychiatristStreamEvent[];
      try {
        replay = await input.loadReplay({
          afterEventId: input.afterEventId,
          config: input.config,
          turnId: input.turnId,
        });
      } catch (error) {
        closed = true;
        unsubscribe?.();
        throw error;
      }
      for (const event of replay) {
        enqueueNow(event);
        if (closed) {
          return;
        }
      }
      replaying = false;
      for (const event of liveBuffer) {
        enqueueNow(event);
        if (closed) {
          return;
        }
      }
    },
    cancel() {
      unsubscribe?.();
    },
  });
}

export function encodePsychiatristServerSentEvent(
  event: PsychiatristStreamEvent,
): string {
  return [
    `id: ${event.eventId}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

function isTerminalEvent(event: PsychiatristStreamEvent): boolean {
  return event.type === "psychiatrist.answer.completed" ||
    event.type === "psychiatrist.regenerate.completed" ||
    event.type === "psychiatrist.answer.failed" ||
    event.type === "psychiatrist.network.permission_required" ||
    event.type === "psychiatrist.turn.canceled";
}
