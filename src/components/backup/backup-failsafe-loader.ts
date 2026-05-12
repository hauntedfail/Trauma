import { query } from "@solidjs/router";

import { loadRuntimeTraumaConfig } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { getBackupFailsafeStatus } from "~/server/backup/environment";

export const getBackupFailsafeAlert = query(async () => {
  "use server";

  const config = loadRuntimeTraumaConfig();
  const connection = initializeDatabase(config);
  try {
    return (await getBackupFailsafeStatus({ config, db: connection.db })).alert;
  } finally {
    connection.close();
  }
}, "backup-failsafe-alert");
