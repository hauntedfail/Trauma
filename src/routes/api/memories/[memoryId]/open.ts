import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";

export async function POST(event: APIEvent): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return json({ error: "memoryId must be a non-empty string" }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const updated = await connection.repositories.memories.markOpened({
      memoryId,
      openedAt: new Date(),
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
  } finally {
    connection.close();
  }
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
