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
import {
  loadPsychiatristTurnSafeError,
  loadPsychiatristTurnTerminalStatus,
  reconcileInactivePsychiatristTurns,
} from "./thread-store";
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
    : (await loadInactiveReplay({
      afterEventId,
      config,
      loadReplay,
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

async function loadInactiveReplay(input: {
  afterEventId?: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  loadReplay: LoadPsychiatristStreamReplay;
  turnId: string;
}): Promise<PsychiatristStreamEvent[]> {
  const fullReplay = await input.loadReplay({
    config: input.config,
    turnId: input.turnId,
  });
  if (fullReplay.length === 0 || fullReplay.some(isTerminalEvent)) {
    return filterReplayAfterEventId(fullReplay, input.afterEventId);
  }
  const memoryId = fullReplay[0]?.memoryId;
  const threadId = fullReplay[0]?.threadId;
  if (memoryId === undefined || threadId === undefined) {
    return filterReplayAfterEventId(fullReplay, input.afterEventId);
  }
  await reconcileInactivePsychiatristTurns({
    activeTurnIds: [],
    config: input.config,
    threadId,
  });
  const reconciledFullReplay = await input.loadReplay({
    config: input.config,
    threadId,
    turnId: input.turnId,
  });
  if (reconciledFullReplay.some(isTerminalEvent)) {
    return filterReplayAfterEventId(reconciledFullReplay, input.afterEventId);
  }
  const terminalStatus = await loadPsychiatristTurnTerminalStatus({
    config: input.config,
    threadId,
    turnId: input.turnId,
  });
  const filteredReplay = filterReplayAfterEventId(reconciledFullReplay, input.afterEventId);
  if (terminalStatus !== "failed") {
    return filteredReplay;
  }
  const safeError = await loadPsychiatristTurnSafeError({
    config: input.config,
    threadId,
    turnId: input.turnId,
  });
  const syntheticEventId = nextReplayEventId(reconciledFullReplay);
  if (input.afterEventId !== undefined && syntheticEventId <= input.afterEventId) {
    return filteredReplay;
  }
  return [
    ...filteredReplay,
    {
      data: {
        code: safeError?.code ?? "turn_interrupted",
      },
      eventId: syntheticEventId,
      memoryId: reconciledFullReplay[0]?.memoryId ?? memoryId,
      threadId,
      timestamp: Date.now(),
      turnId: input.turnId,
      type: "psychiatrist.answer.failed",
    },
  ];
}

function filterReplayAfterEventId(
  replay: PsychiatristStreamEvent[],
  afterEventId: string | undefined,
): PsychiatristStreamEvent[] {
  const normalizedReplay = normalizeReplayTerminalEvents(replay);
  if (afterEventId === undefined) {
    return normalizedReplay;
  }
  return normalizedReplay.filter((event) => event.eventId > afterEventId);
}

function normalizeReplayTerminalEvents(
  replay: PsychiatristStreamEvent[],
): PsychiatristStreamEvent[] {
  const lastTerminalEventId = replay.findLast(isTerminalEvent)?.eventId;
  if (lastTerminalEventId === undefined) {
    return replay;
  }
  return replay.filter((event) => {
    return !isTerminalEvent(event) || event.eventId === lastTerminalEventId;
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
      replay = normalizeReplayTerminalEvents(replay);
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

function nextReplayEventId(replay: PsychiatristStreamEvent[]): string {
  const lastEventId = replay.at(-1)?.eventId;
  const lastEventNumber = lastEventId === undefined ? 0 : Number.parseInt(lastEventId, 10);
  return String(Number.isFinite(lastEventNumber) ? lastEventNumber + 1 : 1).padStart(12, "0");
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
