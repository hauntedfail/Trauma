import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import {
  isMemoryTriageState,
  MEMORY_TRIAGE_STATES,
  type MemoryTriageState,
} from "~/server/db/repositories";
import { readJsonMutationRequest } from "~/server/http/mutation-request";

type TriagePayload =
  | {
      ok: true;
      triageState: MemoryTriageState;
      todayCap?: number | null;
    }
  | { ok: false; error: string; status?: number };

const ALLOWED_KEYS = new Set([
  "triage_state",
  "triageState",
  "todayCap",
  "today_cap",
]);

export async function POST(event: APIEvent): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return json({ error: "memoryId must be a non-empty string" }, { status: 400 });
  }

  const payload = await parseTriagePayload(event.request);
  if (!payload.ok) {
    return json({ error: payload.error }, { status: payload.status ?? 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const result = await connection.repositories.memories.setTriageState({
      memoryId,
      triageState: payload.triageState,
      todayCap: payload.todayCap,
      now: new Date(),
    });

    if (result.status === "not_found") {
      return json({ error: "memory was not found" }, { status: 404 });
    }

    if (result.status === "today_cap_reached") {
      return json(
        {
          error: "Today is full. Finish or return one first.",
          code: "today_cap_reached",
          todayCount: result.todayCount,
          todayCap: result.todayCap,
        },
        { status: 409 },
      );
    }

    const triageChangedAt = result.memory.triageChangedAt.toISOString();
    return json(
      {
        memoryId: result.memory.id,
        triageState: result.memory.triageState,
        triage_state: result.memory.triageState,
        triageChangedAt,
        triage_changed_at: triageChangedAt,
        changed: result.changed,
      },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

async function parseTriagePayload(request: Request): Promise<TriagePayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }

  const payload = body.payload;
  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        error: `unexpected field in request body: ${key}`,
      };
    }
  }

  const hasSnakeState = Object.hasOwn(payload, "triage_state");
  const hasCamelState = Object.hasOwn(payload, "triageState");
  if (!hasSnakeState && !hasCamelState) {
    return {
      ok: false,
      error: `triage_state must be one of: ${MEMORY_TRIAGE_STATES.join(", ")}`,
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
    };
  }

  const rawState = hasSnakeState ? payload.triage_state : payload.triageState;
  if (!isMemoryTriageState(rawState)) {
    return {
      ok: false,
      error: `triage_state must be one of: ${MEMORY_TRIAGE_STATES.join(", ")}`,
    };
  }

  const hasCamelCap = Object.hasOwn(payload, "todayCap");
  const hasSnakeCap = Object.hasOwn(payload, "today_cap");
  if (hasCamelCap && hasSnakeCap && payload.todayCap !== payload.today_cap) {
    return {
      ok: false,
      error: "todayCap and today_cap must match when both are provided",
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
      };
    }
  }

  return {
    ok: true,
    triageState: rawState,
    todayCap,
  };
}

function json(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
