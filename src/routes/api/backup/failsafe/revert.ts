import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import {
  BackupFailsafeActionError,
  BackupFailsafeRestartRequiredError,
  revertBackupFailsafeConfig,
} from "~/server/backup/failsafe";
import {
  RuntimeProcessLeaseError,
  RuntimeStorageBusyError,
} from "~/server/runtime/process-lease";
import { releaseRuntimeRequestAdmission } from "~/server/runtime/request-admission";
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
  let connectionClosed = false;
  const closeConnection = () => {
    if (!connectionClosed) {
      connection.close();
      connectionClosed = true;
    }
  };
  try {
    const result = await revertBackupFailsafeConfig({
      config,
      db: connection.db,
      apply: true,
      beforeRootChange: () => {
        try {
          closeConnection();
        } finally {
          releaseRuntimeRequestAdmission(event);
        }
      },
      expectedGeneration: confirmation.generation,
    });
    return json(result, { status: 200 });
  } catch (error) {
    if (error instanceof RuntimeProcessLeaseError) {
      return json(
        {
          error: "Backup recovery storage is active in another TRAUMA process. Stop it and retry.",
          restartRequired: false,
        },
        { status: 409 },
      );
    }
    if (error instanceof RuntimeStorageBusyError) {
      return json(
        { error: error.message, restartRequired: false },
        { status: 409 },
      );
    }
    if (error instanceof BackupFailsafeRestartRequiredError) {
      return json(
        { error: error.message, restartRequired: true },
        { status: 500 },
      );
    }
    if (error instanceof BackupFailsafeActionError) {
      return json({ error: error.message }, { status: 409 });
    }
    throw error;
  } finally {
    closeConnection();
  }
}
