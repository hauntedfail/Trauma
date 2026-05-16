import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { MomentBrowseRow } from "../db/repositories";

export async function loadMomentBrowseRows(): Promise<MomentBrowseRow[]> {
  "use server";

  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    const config = loadRuntimeTraumaConfig();
    connection = initializeDatabase(config);
    const rows = await connection.repositories.moments.listForBrowse();
    return rows;
  } finally {
    connection?.close();
  }
}
