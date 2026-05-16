import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue } from "~/server/backup";
import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { deleteMemory } from "~/server/memories/delete-memory";

export async function DELETE(event: APIEvent): Promise<Response> {
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
    const result = await deleteMemory({
      backupQueue: getMemoryBackupQueue(config),
      config,
      db: connection.db,
      memoryId,
    });
    if (result.status === "not_found") {
      return json({ error: "memory was not found" }, { status: 404 });
    }
    if (result.status === "failed") {
      return json({ error: "failed to delete memory" }, { status: 500 });
    }

    return new Response(null, { status: 204 });
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
