import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import {
  BackupFailsafeActionError,
  migrateBackupFailsafeContent,
} from "~/server/backup/failsafe";
import {
  formatConfigError,
  json,
  readConfirmedJsonRequest,
} from "./request";

export async function POST(event: APIEvent): Promise<Response> {
  const confirmation = await readConfirmedJsonRequest(event.request);
  if (!confirmation.ok) {
    return confirmation.response;
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
