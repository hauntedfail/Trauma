import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

import { loadTraumaConfig } from "./src/server/config";

const DEFAULT_DATABASE_PATH = "./.trauma/trauma.sqlite";

export default defineConfig({
  dbCredentials: {
    url: resolveDatabasePath(),
  },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/server/db/schema.ts",
});

function resolveDatabasePath() {
  if (process.env.TRAUMA_DATABASE_PATH) {
    return process.env.TRAUMA_DATABASE_PATH;
  }

  if (process.env.TRAUMA_CONFIG_PATH) {
    try {
      return loadTraumaConfig({ configPath: process.env.TRAUMA_CONFIG_PATH }).databasePath;
    } catch (error) {
      throw new Error(
        `Failed to resolve drizzle database path from TRAUMA_CONFIG_PATH=${process.env.TRAUMA_CONFIG_PATH}: ${String(error)}`,
      );
    }
  }

  const configPath = resolve("trauma.config.json");
  if (existsSync(configPath)) {
    return loadTraumaConfig({ configPath }).databasePath;
  }

  return DEFAULT_DATABASE_PATH;
}
