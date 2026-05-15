import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { FlashbackBrowseRow } from "../db/repositories";

export async function loadFlashbackBrowseRows(): Promise<FlashbackBrowseRow[]> {
  "use server";

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const rows = await connection.repositories.flashbacks.listForBrowse();
    return rows;
  } finally {
    connection?.close();
  }
}
