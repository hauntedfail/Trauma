import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { getBackupFailsafeStatus } from "~/server/backup/environment";

export async function GET(_event: APIEvent): Promise<Response> {
  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const status = await getBackupFailsafeStatus({
      config,
      db: connection.db,
    });
    return json(status, { status: 200 });
  } finally {
    connection.close();
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
