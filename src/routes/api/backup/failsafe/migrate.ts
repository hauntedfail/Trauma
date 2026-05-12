import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import {
  BackupFailsafeActionError,
  migrateBackupFailsafeContent,
} from "~/server/backup/failsafe";

export async function POST(event: APIEvent): Promise<Response> {
  const confirmed = await readConfirmation(event.request);
  if (!confirmed) {
    return json({ error: "confirmation is required" }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const result = await migrateBackupFailsafeContent({
      config,
      db: connection.db,
      apply: true,
    });
    return json(result, { status: 200 });
  } catch (error) {
    if (error instanceof BackupFailsafeActionError) {
      return json({ error: error.message }, { status: 409 });
    }
    throw error;
  } finally {
    connection.close();
  }
}

async function readConfirmation(request: Request) {
  try {
    const payload = await request.json();
    return isRecord(payload) && payload.confirm === true;
  } catch {
    return false;
  }
}

function json(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function formatConfigError(error: unknown) {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }
  return "failed to load Trauma configuration";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
