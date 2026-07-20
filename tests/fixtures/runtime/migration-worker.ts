import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { setRuntimeLeaseCoordinatorPathForTesting } from "../../../src/server/runtime/process-lease";

const testCoordinatorPath = process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
if (testCoordinatorPath !== undefined) {
  setRuntimeLeaseCoordinatorPathForTesting(testCoordinatorPath);
}

const serializedConfig = process.env.TRAUMA_TEST_CONFIG;
if (serializedConfig === undefined) {
  throw new Error("TRAUMA_TEST_CONFIG is required");
}
const config = JSON.parse(serializedConfig) as ResolvedTraumaConfig;

process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
await new Promise<void>((resolve, reject) => {
  process.stdin.setEncoding("utf8");
  process.stdin.once("data", (command: string) => {
    process.stdin.pause();
    if (command.trim() !== "initialize") {
      reject(new Error(`expected initialize, received ${command.trim()}`));
      return;
    }
    resolve();
  });
});

try {
  const connection = initializeDatabase(config, {
    runMigrations: process.env.TRAUMA_TEST_RUN_MIGRATIONS === "false"
      ? false
      : undefined,
  });
  try {
    const migrations = connection.sqlite
      .query<{ count: number }, []>(
        "select count(*) as count from __drizzle_migrations",
      )
      .get();
    process.stdout.write(
      `${JSON.stringify({
        migrations: migrations?.count ?? 0,
        type: "initialized",
      })}\n`,
    );
  } finally {
    connection.close();
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    })}\n`,
  );
  process.exit(1);
}
