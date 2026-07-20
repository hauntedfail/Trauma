import type { ResolvedTraumaConfig } from "../../../src/server/config";
import {
  acquireDatabaseInitializationLease,
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

try {
  const lease = acquireDatabaseInitializationLease(config);
  process.stdout.write(`${JSON.stringify({ type: "acquired" })}\n`);
  if (process.env.TRAUMA_TEST_EXIT_WITHOUT_RELEASE === "1") {
    process.exit(0);
  }
  await new Promise<void>((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
  lease.release();
  process.stdout.write(`${JSON.stringify({ type: "released" })}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    })}\n`,
  );
  process.exit(1);
}
