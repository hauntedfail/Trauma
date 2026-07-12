import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { activePsychiatristTurns } from "./active-turns";
import { matchesPsychiatristVariantScope } from "./request";
import {
  loadPsychiatristStreamReplay,
  subscribePsychiatristStream,
} from "./stream-store";
import {
  loadPsychiatristTurnSafeError,
  loadPsychiatristTurnTerminalStatus,
  loadPsychiatristThreadForMemory,
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
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return new Response("memoryId must be a non-empty string", { status: 400 });
  }
  const threadId = event.params.threadId?.trim();
  if (threadId === undefined || threadId === "") {
    return new Response("threadId must be a non-empty string", { status: 400 });
  }
  const turnId = event.params.turnId?.trim();
  if (turnId === undefined || turnId === "") {
    return new Response("turnId must be a non-empty string", { status: 400 });
  }
  const url = new URL(event.request.url);
  const afterEventId =
    url.searchParams.get("after_event_id") ??
    event.request.headers.get("Last-Event-ID") ??
    undefined;
  const config = input.config ?? loadRuntimeTraumaConfig();
  const variantKind = url.searchParams.get("variant_kind");
  const langCode = url.searchParams.get("lang_code") ?? undefined;
  if (
    variantKind !== null &&
    variantKind !== "source" &&
    variantKind !== "translation"
  ) {
    return new Response("variant_kind must be source or translation", { status: 400 });
  }
  if (variantKind !== null || langCode !== undefined) {
    const thread = await loadPsychiatristThreadForMemory({
      config,
      memoryId,
      threadId,
    }).catch(() => undefined);
    if (
      thread === undefined ||
      !matchesPsychiatristVariantScope({
        ...(langCode === undefined ? {} : { langCode }),
        ...(variantKind === null ? {} : { variantKind }),
      }, thread.manifest)
    ) {
      return new Response("Psychiatrist turn was not found", { status: 404 });
    }
  }
  const loadReplay = input.loadReplay ?? loadPsychiatristStreamReplay;
  const subscribe = input.subscribe ?? subscribePsychiatristStream;
  const activeTurn = activePsychiatristTurns.getByTurnId(turnId);
  const isLiveTurn = activeTurn?.memoryId === memoryId && activeTurn.threadId === threadId;
  const body = isLiveTurn
    ? createLiveEventStream({
      afterEventId,
      config,
      loadReplay,
      memoryId,
      subscribe,
      threadId,
      turnId,
    })
    : (await loadInactiveReplay({
      afterEventId,
      config,
      loadReplay,
      memoryId,
      threadId,
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
  memoryId: string;
  threadId: string;
  turnId: string;
}): Promise<PsychiatristStreamEvent[]> {
  const fullReplay = await input.loadReplay({
    config: input.config,
    memoryId: input.memoryId,
    threadId: input.threadId,
    turnId: input.turnId,
  });
  if (fullReplay.some((event) =>
    event.memoryId !== input.memoryId || event.threadId !== input.threadId
  )) {
    return [];
  }
  if (fullReplay.some(isTerminalEvent)) {
    return filterReplayAfterEventId(fullReplay, input.afterEventId);
  }
  const activeThreadTurn = activePsychiatristTurns.getByThreadId(input.threadId);
  await reconcileInactivePsychiatristTurns({
    activeTurnIds: activeThreadTurn === undefined ? [] : [activeThreadTurn.turnId],
    config: input.config,
    memoryId: input.memoryId,
    targetTurnId: input.turnId,
    threadId: input.threadId,
  });
  const reconciledFullReplay = await input.loadReplay({
    config: input.config,
    memoryId: input.memoryId,
    threadId: input.threadId,
    turnId: input.turnId,
  });
  if (reconciledFullReplay.some(isTerminalEvent)) {
    return filterReplayAfterEventId(reconciledFullReplay, input.afterEventId);
  }
  const terminalStatus = await loadPsychiatristTurnTerminalStatus({
    config: input.config,
    memoryId: input.memoryId,
    threadId: input.threadId,
    turnId: input.turnId,
  });
  const filteredReplay = filterReplayAfterEventId(reconciledFullReplay, input.afterEventId);
  if (terminalStatus !== "failed") {
    return filteredReplay;
  }
  const safeError = await loadPsychiatristTurnSafeError({
    config: input.config,
    memoryId: input.memoryId,
    threadId: input.threadId,
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
      memoryId: input.memoryId,
      threadId: input.threadId,
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
  memoryId: string;
  subscribe: SubscribePsychiatristStream;
  threadId: string;
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
          memoryId: input.memoryId,
          threadId: input.threadId,
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
