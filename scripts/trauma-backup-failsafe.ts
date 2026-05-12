import { loadTraumaConfig } from "../src/server/config";
import { initializeDatabase } from "../src/server/db";
import {
  migrateBackupFailsafeContent,
  readActiveBackupFailsafeAlert,
  revertBackupFailsafeConfig,
} from "../src/server/backup/failsafe";
import { getBackupFailsafeStatus } from "../src/server/backup/environment";

type Command = "status" | "revert" | "migrate";

export async function runBackupFailsafeCli(args: readonly string[]) {
  const parsed = parseArgs(args);
  const config = loadTraumaConfig({ configPath: parsed.configPath });
  const connection = initializeDatabase(config);
  try {
    if (parsed.command === "status") {
      const status = await getBackupFailsafeStatus({
        config,
        db: connection.db,
      });
      return status.alert === null
        ? "No active backup failsafe alert.\n"
        : `${JSON.stringify(status.alert, null, 2)}\n`;
    }

    if (parsed.command === "revert") {
      const result = await revertBackupFailsafeConfig({
        config,
        db: connection.db,
        apply: parsed.apply,
      });
      return `${result.summary}\n`;
    }

    const result = await migrateBackupFailsafeContent({
      config,
      db: connection.db,
      apply: parsed.apply,
    });
    const alert = await readActiveBackupFailsafeAlert(connection.db);
    const suffix = alert === null ? "Alert cleared.\n" : "Alert remains active.\n";
    return `${result.summary}\n${suffix}`;
  } finally {
    connection.close();
  }
}

function parseArgs(args: readonly string[]) {
  const command = args[0];
  if (!isCommand(command)) {
    throw new Error(
      "Usage: trauma-backup-failsafe.ts <status|revert|migrate> --config <path> [--apply]",
    );
  }

  let configPath: string | undefined;
  let apply = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--config") {
      configPath = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (configPath === undefined || configPath.trim() === "") {
    throw new Error("--config is required");
  }

  return { command, configPath, apply };
}

function isCommand(value: string | undefined): value is Command {
  return value === "status" || value === "revert" || value === "migrate";
}

if (import.meta.main) {
  try {
    process.stdout.write(await runBackupFailsafeCli(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
