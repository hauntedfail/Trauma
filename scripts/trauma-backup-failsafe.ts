import { loadTraumaConfig } from "../src/server/config";
import { initializeDatabase } from "../src/server/db";
import {
  type BackupFailsafeActionResult,
  deleteMissingBackupContentRecord,
  migrateBackupFailsafeContent,
  readActiveBackupFailsafeAlert,
  revertBackupFailsafeConfig,
} from "../src/server/backup/failsafe";
import { withRuntimeProcessLease } from "../src/server/runtime/process-lease";

type Command = "status" | "revert" | "migrate" | "delete-missing-record";

export async function runBackupFailsafeCli(args: readonly string[]) {
  const parsed = parseArgs(args);
  const config = loadTraumaConfig({ configPath: parsed.configPath });
  return withRuntimeProcessLease(config, async () => {
    const connection = initializeDatabase(config);
    let connectionClosed = false;
    const closeConnection = () => {
      if (!connectionClosed) {
        connection.close();
        connectionClosed = true;
      }
    };
    try {
      if (parsed.command === "status") {
        const alert = await readActiveBackupFailsafeAlert(connection.db);
        return alert === null
          ? "No active backup failsafe alert.\n"
          : `${JSON.stringify(alert, null, 2)}\n`;
      }

      if (parsed.command === "revert") {
        const result = await revertBackupFailsafeConfig({
          config,
          db: connection.db,
          apply: parsed.apply,
          beforeRootChange: closeConnection,
          expectedGeneration: parsed.generation,
        });
        return parsed.apply
          ? `${result.summary}\n`
          : formatBackupFailsafeDryRunApproval(result);
      }

      if (parsed.command === "delete-missing-record") {
        const result = await deleteMissingBackupContentRecord({
          config,
          db: connection.db,
          apply: parsed.apply,
          expectedGeneration: parsed.generation,
        });
        if (!parsed.apply) {
          return formatBackupFailsafeDryRunApproval(result);
        }
        const alert = await readActiveBackupFailsafeAlert(connection.db);
        const suffix = alert === null ? "Alert cleared.\n" : "Alert remains active.\n";
        return `${result.summary}\n${suffix}`;
      }

      const result = await migrateBackupFailsafeContent({
        config,
        db: connection.db,
        apply: parsed.apply,
        expectedGeneration: parsed.generation,
      });
      if (!parsed.apply) {
        return formatBackupFailsafeDryRunApproval(result);
      }
      const alert = await readActiveBackupFailsafeAlert(connection.db);
      const suffix = alert === null ? "Alert cleared.\n" : "Alert remains active.\n";
      return `${result.summary}\n${suffix}`;
    } finally {
      closeConnection();
    }
  });
}

function parseArgs(args: readonly string[]) {
  const command = args[0];
  if (!isCommand(command)) {
    throw new Error(
      "Usage: trauma-backup-failsafe.ts <status|revert|migrate|delete-missing-record> --config <path> [--apply --generation <token>]",
    );
  }

  let configPath: string | undefined;
  let apply = false;
  let generation: string | undefined;
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
    if (arg === "--generation") {
      generation = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (configPath === undefined || configPath.trim() === "") {
    throw new Error("--config is required");
  }

  if (apply && (generation === undefined || !/^[a-f0-9]{64}$/u.test(generation))) {
    throw new Error("--generation is required with --apply");
  }
  if (!apply && generation !== undefined) {
    throw new Error("--generation can only be used with --apply");
  }

  return { command, configPath, apply, generation };
}

export function formatBackupFailsafeDryRunApproval(
  result: Pick<BackupFailsafeActionResult, "dryRun" | "generation" | "summary">,
) {
  if (!result.dryRun) {
    throw new Error("backup failsafe approval output requires a dry-run result");
  }
  return `${result.summary}\ngeneration: ${result.generation}\n`;
}

function isCommand(value: string | undefined): value is Command {
  return (
    value === "status" ||
    value === "revert" ||
    value === "migrate" ||
    value === "delete-missing-record"
  );
}

if (import.meta.main) {
  try {
    process.stdout.write(await runBackupFailsafeCli(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
