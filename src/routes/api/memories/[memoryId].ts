import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue, type MemoryBackupQueue } from "~/server/backup";
import { BackupEnvironmentFailsafeError } from "~/server/backup/environment";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "~/server/config";
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
    let result;
    try {
      result = await deleteMemory({
        backupQueue: resolveDeleteMemoryBackupQueueInternal({ config }),
        config,
        db: connection.db,
        memoryId,
      });
    } catch (error) {
      if (error instanceof BackupEnvironmentFailsafeError) {
        return json(
          {
            error: error.message,
            backupFailsafe: error.alert ?? null,
          },
          { status: 409 },
        );
      }

      console.error("Unexpected memory delete failure", error);
      return json({ error: "failed to delete memory" }, { status: 500 });
    }
    if (result.status === "not_found") {
      return json({ error: "memory was not found" }, { status: 404 });
    }
    if (result.status === "failed") {
      return json({ error: "failed to delete memory" }, { status: 500 });
    }
    if (result.warnings !== undefined) {
      for (const warning of result.warnings) {
        console.warn("Memory delete completed with warning", {
          kind: warning.kind,
          memoryId,
          error: warning.error,
        });
      }
    }

    return new Response(null, { status: 204 });
  } finally {
    connection.close();
  }
}

export const resolveDeleteMemoryBackupQueue =
  resolveDeleteMemoryBackupQueueInternal;

function resolveDeleteMemoryBackupQueueInternal(input: {
  config: ResolvedTraumaConfig;
  getQueue?: (config: ResolvedTraumaConfig) => MemoryBackupQueue;
}): MemoryBackupQueue | undefined {
  if (input.config.backup.git.enabled) {
    return undefined;
  }

  return (input.getQueue ?? getMemoryBackupQueue)(input.config);
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
