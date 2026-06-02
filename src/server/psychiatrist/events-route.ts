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

export function createPsychiatristTurnEventsHandler(input: {
  config?: Pick<ResolvedTraumaConfig, "storePath">;
} = {}) {
  return async function psychiatristTurnEvents(event: APIEvent): Promise<Response> {
    return handlePsychiatristTurnEventsRequest(event, input);
  };
}

export async function handlePsychiatristTurnEventsRequest(
  event: APIEvent,
  input: {
    config?: Pick<ResolvedTraumaConfig, "storePath">;
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
  const replay = await loadPsychiatristStreamReplay({
    afterEventId,
    config,
    turnId,
  });
  const body = activePsychiatristTurns.getByTurnId(turnId) === undefined
    ? replay.map(encodePsychiatristServerSentEvent).join("")
    : createLiveEventStream({ replay, turnId });
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
  replay: PsychiatristStreamEvent[];
  turnId: string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  return new ReadableStream({
    start(controller) {
      for (const event of input.replay) {
        controller.enqueue(encoder.encode(encodePsychiatristServerSentEvent(event)));
      }
      unsubscribe = subscribePsychiatristStream({
        onEvent: (event) => {
          controller.enqueue(encoder.encode(encodePsychiatristServerSentEvent(event)));
          if (isTerminalEvent(event)) {
            unsubscribe?.();
            controller.close();
          }
        },
        turnId: input.turnId,
      });
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
    event.type === "psychiatrist.turn.canceled";
}
