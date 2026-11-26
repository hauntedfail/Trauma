import { loadTraumaConfig } from "../src/server/config";
import { initializeDatabase } from "../src/server/db";
import { backfillMemoryWordCounts } from "../src/server/memories/word-count";
import { backfillMemorySearchIndex } from "../src/server/search";

interface ParsedArguments {
  configPath?: string;
  help: boolean;
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(
        "Usage: bun run db:migrate [--config <trauma.config.json>]\n",
      );
    } else {
      await migrateDatabase(args.configPath);
    }
  } catch (error) {
    process.stderr.write(`${formatUnknownError(error)}\n`);
    process.exitCode = 1;
  }
}

void main();

async function migrateDatabase(configPath?: string) {
  const config = loadTraumaConfig({
    configPath: configPath ?? process.env.TRAUMA_CONFIG_PATH,
  });
  const connection = initializeDatabase(config);

  try {
    const searchBackfill = await backfillMemorySearchIndex({
      db: connection.sqlite,
      storePath: config.storePath,
    });
    const wordCountBackfill = await backfillMemoryWordCounts({
      db: connection.sqlite,
      storePath: config.storePath,
    });
    process.stdout.write(
      `Applied runtime migrations to ${config.databasePath} (indexed ${searchBackfill.indexed} memories; word_count filled ${wordCountBackfill.filled}, skipped ${wordCountBackfill.skippedMissingFiles}, errored ${wordCountBackfill.errors.length})\n`,
    );
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
