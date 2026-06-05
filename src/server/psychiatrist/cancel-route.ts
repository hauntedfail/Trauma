import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { jsonResponse } from "../http/json";
import {
  activePsychiatristTurns,
  type ActivePsychiatristTurnRegistry,
} from "./active-turns";
import { appendPsychiatristStreamEvent } from "./stream-store";
import {
  loadPsychiatristTurnTerminalStatus,
  markPsychiatristTurnCanceled,
} from "./thread-store";

export function createCancelPsychiatristTurnHandler(input: {
  activeTurns?: ActivePsychiatristTurnRegistry;
  config?: Pick<ResolvedTraumaConfig, "storePath">;
} = {}) {
  return async function cancelPsychiatristTurn(event: APIEvent): Promise<Response> {
    return handleCancelPsychiatristTurnRequest(event, input);
  };
}

export async function handleCancelPsychiatristTurnRequest(
  event: APIEvent,
  input: {
    activeTurns?: ActivePsychiatristTurnRegistry;
    config?: Pick<ResolvedTraumaConfig, "storePath">;
  } = {},
): Promise<Response> {
  const turnId = event.params.turnId?.trim();
  if (turnId === undefined || turnId === "") {
    return safeErrorResponse("invalid_request", "turnId must be a non-empty string.", 400);
  }
  const activeTurns = input.activeTurns ?? activePsychiatristTurns;
  const active = activeTurns.getByTurnId(turnId);
  if (active === undefined) {
    return safeErrorResponse("thread_not_found", "Active Psychiatrist turn was not found.", 404);
  }
  if (active.codexThreadId === undefined || active.codexTurnId === undefined) {
    return safeErrorResponse(
      "turn_not_ready",
      "Psychiatrist turn is still starting. Retry Stop after the turn is ready.",
      409,
    );
  }
  const config = input.config ?? loadRuntimeTraumaConfig();
  const terminalStatus = await loadPsychiatristTurnTerminalStatus({
    config,
    threadId: active.threadId,
    turnId: active.turnId,
  });
  if (terminalStatus !== undefined) {
    activeTurns.unregister(turnId);
    return jsonResponse({
      status: terminalStatus,
      turn_id: turnId,
    }, { status: 200 });
  }
  let interruptFailed = false;
  try {
    await active.client.cancelTurn({
      threadId: active.codexThreadId,
      turnId: active.codexTurnId,
    });
  } catch {
    interruptFailed = true;
  }
  const cancelStatus = await markPsychiatristTurnCanceled({
    codexThreadId: active.codexThreadId,
    codexTurnId: active.codexTurnId,
    config,
    pairId: active.pairId,
    threadId: active.threadId,
    turnId: active.turnId,
  });
  if (cancelStatus !== "canceled") {
    activeTurns.unregister(turnId);
    return jsonResponse({
      status: cancelStatus,
      turn_id: turnId,
    }, { status: 200 });
  }
  await appendPsychiatristStreamEvent({
    config,
    event: {
      data: {
        ...(interruptFailed
          ? {
            warning: {
              code: "codex_interrupt_failed",
              message: "Psychiatrist turn was released locally after Codex interrupt failed.",
            },
          }
          : {}),
        status: "canceled",
      },
      memoryId: active.memoryId,
      threadId: active.threadId,
      turnId: active.turnId,
      type: "psychiatrist.turn.canceled",
    },
  });
  activeTurns.unregister(turnId);
  return jsonResponse({
    ...(interruptFailed
      ? {
        warning: {
          code: "codex_interrupt_failed",
          message: "Psychiatrist turn was released locally after Codex interrupt failed.",
        },
      }
      : {}),
    status: "canceled",
    turn_id: turnId,
  }, { status: 202 });
}

function safeErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse(
    {
      action: code === "thread_not_found" ? "open_reader" : "retry",
      code,
      message,
      status: "error",
    },
    { status },
  );
}
