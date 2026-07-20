import { Database } from "bun:sqlite";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import {
  acquireRuntimeProcessLease,
  setRuntimeLeaseCoordinatorPathForTesting,
} from "../../../src/server/runtime/process-lease";

const coordinatorPath = process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
if (coordinatorPath !== undefined) {
  setRuntimeLeaseCoordinatorPathForTesting(coordinatorPath);
}
const serializedConfig = process.env.TRAUMA_TEST_CONFIG;
if (serializedConfig === undefined) {
  throw new Error("TRAUMA_TEST_CONFIG is required");
}
const config = JSON.parse(serializedConfig) as ResolvedTraumaConfig;

const originalClose = Database.prototype.close;
let heldDatabase: Database | undefined;

function createFailedRuntimeBorrow(): void {
  const owner = acquireRuntimeProcessLease(config);
  Database.prototype.close = function close(...args) {
    if (this.filename === config.databasePath) {
      heldDatabase = this;
      throw new Error("injected application database close failure");
    }
    return originalClose.apply(this, args);
  };

  let initializationFailed = false;
  try {
    initializeDatabase(config, {
      migrationsFolder: `${config.projectPath}/missing-migrations`,
    });
  } catch {
    initializationFailed = true;
  } finally {
    Database.prototype.close = originalClose;
  }
  if (!initializationFailed || heldDatabase === undefined) {
    throw new Error("failed to inject retained database close failure");
  }

  owner.release();
}

createFailedRuntimeBorrow();
Bun.gc(true);
process.stdout.write(`${JSON.stringify({ type: "failed-retained" })}\n`);
await new Promise<void>((resolve) => {
  process.stdin.setEncoding("utf8");
  process.stdin.once("data", () => {
    process.stdin.pause();
    resolve();
  });
});
process.exit(0);
