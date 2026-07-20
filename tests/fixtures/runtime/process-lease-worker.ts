import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { isRuntimeLeaseFixtureBypassAllowed } from "../../../src/server/runtime/fixture-mode";
import {
  ensureRuntimeProcessLease,
  setRuntimeLeaseCoordinatorPathForTesting,
} from "../../../src/server/runtime/process-lease";

const testCoordinatorPath = process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
if (testCoordinatorPath !== undefined) {
  setRuntimeLeaseCoordinatorPathForTesting(testCoordinatorPath);
}

const serializedConfig = process.env.TRAUMA_TEST_CONFIG;
if (serializedConfig === undefined) {
  throw new Error("TRAUMA_TEST_CONFIG is required");
}

const config = JSON.parse(serializedConfig) as ResolvedTraumaConfig;
const mode = process.env.TRAUMA_TEST_LEASE_MODE ?? "once";
const commands = mode === "hold" || mode === "lease-only-hold"
  ? createCommandReader()
  : undefined;

try {
  if (
    mode === "middleware-once" &&
    isRuntimeLeaseFixtureBypassAllowed(
      process.env,
      new Request(
        `http://${process.env.HOST ?? "127.0.0.1"}${process.env.TRAUMA_TEST_REQUEST_PATH ?? "/"}`,
        { method: process.env.TRAUMA_TEST_REQUEST_METHOD ?? "GET" },
      ),
    )
  ) {
    writeEvent({ type: "fixture-bypassed" });
    process.exit(0);
  }

  const lease = ensureRuntimeProcessLease(config);
  writeEvent({ pid: process.pid, type: "acquired" });

  if (mode === "exit-without-release") {
    // Deliberately leave the coordinator row and guard artifact in place.
    // Process exit stops application access and releases the OS locks; the next
    // owner is responsible for stale metadata cleanup.
    process.exit(0);
  }

  if (mode === "hold") {
    await waitForCommand("initialize");
  }

  if (mode !== "lease-only-hold") {
    const connection = initializeDatabase(config);
    try {
      const migrations = connection.sqlite
        .query<{ count: number }, []>(
          "select count(*) as count from __drizzle_migrations",
        )
        .get();
      writeEvent({ migrations: migrations?.count ?? 0, type: "initialized" });
    } finally {
      connection.close();
    }
  }

  if (mode === "hold" || mode === "lease-only-hold") {
    await waitForCommand("release");
    commands?.close();
  }

  lease.release();
  writeEvent({ type: "released" });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    })}\n`,
  );
  // Bun can keep a failed fixture alive while inherited stdio or SQLite
  // handles drain. This is a one-shot test worker, so terminate explicitly
  // after the structured error is written.
  process.exit(1);
}

function writeEvent(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function waitForCommand(expected: string): Promise<void> {
  if (commands === undefined) {
    throw new Error("command reader is unavailable");
  }
  const command = await commands.next();
  if (command !== expected) {
    throw new Error(`expected stdin command ${expected}, received ${command}`);
  }
}

function createCommandReader() {
  let buffered = "";
  const queued: string[] = [];
  const pending: Array<(command: string) => void> = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const command = line.trim();
      if (command === "") {
        continue;
      }
      const resolve = pending.shift();
      if (resolve === undefined) {
        queued.push(command);
      } else {
        resolve(command);
      }
    }
  });
  return {
    close() {
      process.stdin.removeAllListeners("data");
      process.stdin.pause();
    },
    next() {
      const command = queued.shift();
      if (command !== undefined) {
        return Promise.resolve(command);
      }
      return new Promise<string>((resolve) => pending.push(resolve));
    },
  };
}
