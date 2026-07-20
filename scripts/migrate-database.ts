import { loadTraumaConfig } from "../src/server/config";
import { initializeDatabase } from "../src/server/db";

interface ParsedArguments {
  configPath?: string;
  help: boolean;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: bun run db:migrate [--config <trauma.config.json>]\n",
    );
  } else {
    migrateDatabase(args.configPath);
  }
} catch (error) {
  process.stderr.write(`${formatUnknownError(error)}\n`);
  process.exitCode = 1;
}

function migrateDatabase(configPath?: string) {
  const config = loadTraumaConfig({
    configPath: configPath ?? process.env.TRAUMA_CONFIG_PATH,
  });
  const connection = initializeDatabase(config);

  try {
    process.stdout.write(`Applied runtime migrations to ${config.databasePath}\n`);
  } finally {
    connection.close();
  }
}

function parseArguments(args: string[]): ParsedArguments {
  let configPath: string | undefined;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--config") {
      const value = args[index + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) {
        throw new Error("--config requires a path");
      }
      if (configPath !== undefined) {
        throw new Error("--config may be provided only once");
      }
      configPath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return { configPath, help };
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
