import { query, revalidate } from "@solidjs/router";

import type { BackupFailsafeAlertView } from "~/server/backup/environment";

export const getBackupFailsafeAlert = query(async () => {
  "use server";

  return loadBackupFailsafeAlert();
}, "backup-failsafe-alert");

export function revalidateBackupFailsafeAlert() {
  return revalidate(getBackupFailsafeAlert.key);
}

export async function loadBackupFailsafeAlert(): Promise<BackupFailsafeAlertView | null> {
  "use server";

  if (process.env.TRAUMA_BROWSE_FIXTURES === "1") {
    return null;
  }

  const [
    { loadRuntimeTraumaConfig },
    { initializeDatabase },
    { getMemoryBackupQueue },
    { getBackupFailsafeStatus },
  ] = await Promise.all([
    import("~/server/config"),
    import("~/server/db"),
    import("~/server/backup"),
    import("~/server/backup/environment"),
  ]);
  const config = loadRuntimeTraumaConfig();
  getMemoryBackupQueue(config);
  const connection = initializeDatabase(config);
  try {
    return (await getBackupFailsafeStatus({ config, db: connection.db })).alert;
  } finally {
    connection.close();
  }
}
