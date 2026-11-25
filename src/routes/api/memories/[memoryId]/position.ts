import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import {
  validateMemoryLastPosition,
  type MemoryLastPosition,
} from "~/server/db/repositories";
import { readJsonMutationRequest } from "~/server/http/mutation-request";

type PositionPayload =
  | { ok: true; kind: "open" }
  | { ok: true; kind: "position"; position: MemoryLastPosition }
  | { ok: false; error: string; status?: number };

export async function POST(event: APIEvent): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return json({ error: "memoryId must be a non-empty string" }, { status: 400 });
  }

  const payload = await parsePositionPayload(event.request);
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
    if (payload.kind === "open") {
      const openedAt = new Date();
      const updated = await connection.repositories.memories.markOpened({
        memoryId,
        openedAt,
      });

      if (updated === undefined) {
        return json({ error: "memory was not found" }, { status: 404 });
      }

      const lastOpenedAt = updated.lastOpenedAt?.toISOString() ?? null;
      return json(
        {
          memoryId: updated.id,
          lastOpenedAt,
          last_opened_at: lastOpenedAt,
        },
        { status: 200 },
      );
    }

    const updated = await connection.repositories.memories.updateLastPosition({
      memoryId,
      lastPosition: payload.position,
      lastOpenedAt: new Date(payload.position.updatedAt),
      updatedAt: new Date(),
    });

    if (updated === undefined) {
      return json({ error: "memory was not found" }, { status: 404 });
    }

    const lastOpenedAt = updated.lastOpenedAt?.toISOString() ?? null;
    return json(
      {
        memoryId: updated.id,
        lastPosition: payload.position,
        last_position: payload.position,
        lastOpenedAt,
        last_opened_at: lastOpenedAt,
      },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

async function parsePositionPayload(request: Request): Promise<PositionPayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }

  if (
    typeof body.payload === "object" &&
    body.payload !== null &&
    !Array.isArray(body.payload) &&
    (body.payload as Record<string, unknown>).openOnly === true
  ) {
    return { ok: true, kind: "open" };
  }

  const validated = validateMemoryLastPosition(body.payload);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  return { ok: true, kind: "position", position: validated.position };
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

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
