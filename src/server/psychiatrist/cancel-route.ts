import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { jsonResponse } from "../http/json";
import {
  activePsychiatristTurns,
  type ActivePsychiatristTurnRegistry,
  type ActivePsychiatristTurn,
} from "./active-turns";
import {
  isRecord,
  readPsychiatristJsonBody,
  readPsychiatristRequestScope,
  type PsychiatristRequestScope,
} from "./request";
import { appendPsychiatristStreamEvent } from "./stream-store";
import {
  loadPsychiatristTurnTerminalStatus,
  markPsychiatristTurnCanceled,
} from "./thread-store";

type CancelPayload =
  | (PsychiatristRequestScope & { ok: true; pairId: string })
  | { ok: false; message: string; status: number };

export function createCancelPsychiatristTurnHandler(input: {
  activeTurns?: ActivePsychiatristTurnRegistry;
  appendStreamEvent?: typeof appendPsychiatristStreamEvent;
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
    appendStreamEvent?: typeof appendPsychiatristStreamEvent;
    config?: Pick<ResolvedTraumaConfig, "storePath">;
  } = {},
): Promise<Response> {
  const turnId = event.params.turnId?.trim();
  if (turnId === undefined || turnId === "") {
    return safeErrorResponse("invalid_request", "turnId must be a non-empty string.", 400);
  }
  const payload = await parseCancelPayload(event.request);
  if (!payload.ok) {
    return safeErrorResponse("invalid_request", payload.message, payload.status);
  }
  const activeTurns = input.activeTurns ?? activePsychiatristTurns;
  const active = activeTurns.getByTurnId(turnId);
  if (active === undefined) {
    return safeErrorResponse("thread_not_found", "Active Psychiatrist turn was not found.", 404);
  }
  if (!matchesActiveTurnScope(payload, active)) {
    return safeErrorResponse(
      "turn_scope_mismatch",
      "Active Psychiatrist turn does not match the requested reader scope.",
      409,
    );
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
  try {
    await (input.appendStreamEvent ?? appendPsychiatristStreamEvent)({
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
  } catch {
    // Cancel state is already persisted; stream telemetry is best-effort.
  } finally {
    activeTurns.unregister(turnId);
  }
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

async function parseCancelPayload(request: Request): Promise<CancelPayload> {
  const body = await readPsychiatristJsonBody(request);
  if (!body.ok) {
    return { ok: false, message: body.message, status: body.status };
  }
  if (!isRecord(body.payload)) {
    return { ok: false, message: "request body must be an object.", status: 400 };
  }
  const scope = readPsychiatristRequestScope(body.payload);
  if (!scope.ok) {
    return { ok: false, message: scope.message, status: 400 };
  }
  const pairId = typeof body.payload.pair_id === "string" && body.payload.pair_id.trim() !== ""
    ? body.payload.pair_id.trim()
    : undefined;
  if (pairId === undefined) {
    return { ok: false, message: "pair_id must be a non-empty string.", status: 400 };
  }
  return { ok: true, pairId, ...scope.scope };
}

function matchesActiveTurnScope(
  payload: Extract<CancelPayload, { ok: true }>,
  active: ActivePsychiatristTurn,
): boolean {
  return payload.memoryId === active.memoryId &&
    payload.threadId === active.threadId &&
    payload.pairId === active.pairId;
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
