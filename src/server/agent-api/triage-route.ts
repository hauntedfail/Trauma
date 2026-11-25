import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { initializeDatabase } from "../db";
import {
  isMemoryTriageState,
  MEMORY_TRIAGE_STATES,
  type MemoryTriageState,
} from "../db/repositories";
import { formatConfigError, jsonResponse } from "../http/json";
import { readJsonMutationRequest } from "../http/mutation-request";
import { agentErrorResponse, isRecord } from "./helpers";
import type { AgentTriageResponse } from "./types";

type ParsedTriagePayload =
  | {
      ok: true;
      triageState: MemoryTriageState;
      todayCap?: number | null;
    }
  | { ok: false; error: string; status: number };

const ALLOWED_KEYS = new Set([
  "triageState",
  "triage_state",
  "todayCap",
  "today_cap",
]);

export interface AgentTriageHandlerDependencies {
  config?: ResolvedTraumaConfig;
  now?: () => Date;
}

export function createAgentTriageHandler(
  deps: AgentTriageHandlerDependencies = {},
) {
  return async function postAgentTriage(event: APIEvent): Promise<Response> {
    return handleAgentTriageRequest(event, deps);
  };
}

export async function handleAgentTriageRequest(
  event: APIEvent,
  deps: AgentTriageHandlerDependencies = {},
): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return agentErrorResponse("memoryId must be a non-empty string", 400);
  }

  const payload = await parseTriagePayload(event.request);
  if (!payload.ok) {
    return agentErrorResponse(payload.error, payload.status);
  }

  let config: ResolvedTraumaConfig;
  try {
    config = deps.config ?? loadRuntimeTraumaConfig();
  } catch (error) {
    return agentErrorResponse(formatConfigError(error), 500);
  }

  const connection = initializeDatabase(config);
  try {
    const result = await connection.repositories.memories.setTriageState({
      memoryId,
      triageState: payload.triageState,
      todayCap: payload.todayCap,
      now: deps.now?.() ?? new Date(),
    });

    if (result.status === "not_found") {
      return agentErrorResponse("memory was not found", 404);
    }

    if (result.status === "today_cap_reached") {
      return agentErrorResponse(
        "Today is full. Finish or return one first.",
        409,
        {
          code: "today_cap_reached",
          todayCount: result.todayCount,
          todayCap: result.todayCap,
        },
      );
    }

    const response: AgentTriageResponse = {
      memoryId: result.memory.id,
      triageState: result.memory.triageState,
      triageChangedAt: result.memory.triageChangedAt.toISOString(),
      changed: result.changed,
    };

    return jsonResponse(response, { status: 200 });
  } finally {
    connection.close();
  }
}

async function parseTriagePayload(
  request: Request,
): Promise<ParsedTriagePayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }

  const payload = body.payload;
  if (!isRecord(payload)) {
    return {
      ok: false,
      error: "request body must be an object",
      status: 400,
    };
  }

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        error: `unexpected field in request body: ${key}`,
        status: 400,
      };
    }
  }

  const hasSnakeState = Object.hasOwn(payload, "triage_state");
  const hasCamelState = Object.hasOwn(payload, "triageState");
  if (!hasSnakeState && !hasCamelState) {
    return {
      ok: false,
      error: `triageState must be one of: ${MEMORY_TRIAGE_STATES.join(", ")}`,
      status: 400,
    };
  }
  if (
    hasSnakeState &&
    hasCamelState &&
    payload.triage_state !== payload.triageState
  ) {
    return {
      ok: false,
      error: "triage_state and triageState must match when both are provided",
      status: 400,
    };
  }

  const rawState = hasCamelState ? payload.triageState : payload.triage_state;
  if (!isMemoryTriageState(rawState)) {
    return {
      ok: false,
      error: `triageState must be one of: ${MEMORY_TRIAGE_STATES.join(", ")}`,
      status: 400,
    };
  }

  const hasCamelCap = Object.hasOwn(payload, "todayCap");
  const hasSnakeCap = Object.hasOwn(payload, "today_cap");
  if (hasCamelCap && hasSnakeCap && payload.todayCap !== payload.today_cap) {
    return {
      ok: false,
      error: "todayCap and today_cap must match when both are provided",
      status: 400,
    };
  }

  let todayCap: number | null | undefined;
  if (hasCamelCap || hasSnakeCap) {
    const rawCap = hasCamelCap ? payload.todayCap : payload.today_cap;
    if (rawCap === null) {
      todayCap = null;
    } else if (
      typeof rawCap === "number" &&
      Number.isInteger(rawCap) &&
      rawCap >= 0
    ) {
      todayCap = rawCap;
    } else {
      return {
        ok: false,
        error: "todayCap must be a non-negative integer or null",
        status: 400,
      };
    }
  }

  return {
    ok: true,
    triageState: rawState,
    todayCap,
  };
}
