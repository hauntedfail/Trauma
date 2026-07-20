import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { resolveRuntimeLeaseCoordinatorPath } from "../../../src/server/runtime/process-lease";

export interface WorkerEvent {
  message?: string;
  migrations?: number;
  pid?: number;
  type:
    | "acquired"
    | "error"
    | "failed-retained"
    | "fixture-bypassed"
    | "initialized"
    | "ready"
    | "released";
}

const roots: string[] = [];
const spawnedChildren = new Set<ChildProcessWithoutNullStreams>();

afterEach(async () => {
  await Promise.all([...spawnedChildren].map(terminateChild));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

export async function createRuntimeConfig(): Promise<{
  config: ResolvedTraumaConfig;
  configPath: string;
  root: string;
}> {
  const root = await createTrackedTemporaryRoot();
  const configPath = join(root, "trauma.config.json");
  const config: ResolvedTraumaConfig = {
    backup: {
      git: {
        branch: "main",
        commitMessageTemplate: "backup {action} {memoryId}",
        enabled: false,
        push: false,
        remote: "origin",
      },
    },
    configFilePath: configPath,
    databasePath: join(root, "runtime", "trauma.sqlite"),
    projectPath: join(root, "project"),
    storePath: join(root, "project", "store"),
  };
  await writeFile(
    configPath,
    `${JSON.stringify({
      backup: config.backup,
      databasePath: "./runtime/trauma.sqlite",
      projectPath: "./project",
      storePath: "./project/store",
    })}\n`,
    "utf8",
  );
  return { config, configPath, root };
}

export async function createTrackedTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-runtime-lease-"));
  roots.push(root);
  return root;
}

export async function startLeaseOwner(config: ResolvedTraumaConfig) {
  const owner = spawnWorker(config, "lease-only-hold");
  await expect(owner.nextStdout()).resolves.toMatchObject({ type: "acquired" });
  return owner;
}

export async function releaseLeaseOwner(
  owner: ReturnType<typeof spawnWorker>,
): Promise<void> {
  owner.send("release");
  await expect(owner.nextStdout()).resolves.toMatchObject({ type: "released" });
  await expect(owner.exit).resolves.toBe(0);
}

export async function expectRuntimeRejected(
  config: ResolvedTraumaConfig,
  message: RegExp,
): Promise<void> {
  const contender = spawnWorker(config, "once");
  const firstEvent = await Promise.race([
    contender.nextStderr().then((event) => ({ channel: "stderr", event })),
    contender.nextStdout().then((event) => ({ channel: "stdout", event })),
  ]);
  expect(firstEvent.channel).toBe("stderr");
  expect(firstEvent.event).toMatchObject({
    message: expect.stringMatching(message),
    type: "error",
  });
  await expect(contender.exit).resolves.not.toBe(0);
}

export function spawnWorker(
  config: ResolvedTraumaConfig,
  mode: "exit-without-release" | "hold" | "lease-only-hold" | "once",
) {
  return spawnFixture("process-lease-worker.ts", config, {
    TRAUMA_TEST_LEASE_MODE: mode,
  });
}

export function spawnMiddlewareWorker(
  config: ResolvedTraumaConfig,
  environment: Record<string, string>,
) {
  return spawnFixture("process-lease-worker.ts", config, {
    ...environment,
    TRAUMA_TEST_LEASE_MODE: "middleware-once",
  });
}

export function spawnMigrationWorker(
  config: ResolvedTraumaConfig,
  options: { runMigrations?: boolean } = {},
) {
  return spawnFixture("migration-worker.ts", config, {
    ...(options.runMigrations === false
      ? { TRAUMA_TEST_RUN_MIGRATIONS: "false" }
      : {}),
  });
}

export function spawnInitializationLeaseWorker(
  config: ResolvedTraumaConfig,
  options: { exitWithoutRelease?: boolean } = {},
) {
  return spawnFixture("database-initialization-lease-worker.ts", config, {
    ...(options.exitWithoutRelease === true
      ? { TRAUMA_TEST_EXIT_WITHOUT_RELEASE: "1" }
      : {}),
  });
}

export function spawnRuntimeCloseFailureWorker(config: ResolvedTraumaConfig) {
  return spawnFixture("runtime-close-failure-worker.ts", config);
}

function spawnFixture(
  fixture: string,
  config: ResolvedTraumaConfig,
  environment: Record<string, string> = {},
) {
  const child = spawn(resolveBunExecutable(), [
    `tests/fixtures/runtime/${fixture}`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...environment,
      TRAUMA_RUNTIME_TEST_CHILD: "1",
      TRAUMA_TEST_CONFIG: JSON.stringify(config),
      TRAUMA_TEST_RUNTIME_COORDINATOR_PATH:
        resolveRuntimeLeaseCoordinatorPath(),
    },
    stdio: "pipe",
  });
  return createWorkerHandle(child);
}

function createWorkerHandle(child: ChildProcessWithoutNullStreams) {
  spawnedChildren.add(child);
  const stdout = createJsonLineReader(child.stdout);
  const stderr = createJsonLineReader(child.stderr);
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      spawnedChildren.delete(child);
      resolve(code);
    });
  });
  return {
    exit,
    kill(signal: NodeJS.Signals) {
      child.kill(signal);
    },
    nextStderr: stderr.next,
    nextStdout: stdout.next,
    send(command: string) {
      child.stdin.write(`${command}\n`);
    },
  };
}

function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    spawnedChildren.delete(child);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

function createJsonLineReader(stream: NodeJS.ReadableStream) {
  let buffered = "";
  const pending: Array<(event: WorkerEvent) => void> = [];
  const events: WorkerEvent[] = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      const event = JSON.parse(line) as WorkerEvent;
      const resolve = pending.shift();
      if (resolve === undefined) {
        events.push(event);
      } else {
        resolve(event);
      }
    }
  });
  return {
    next: () => {
      const event = events.shift();
      if (event !== undefined) {
        return Promise.resolve(event);
      }
      return new Promise<WorkerEvent>((resolve) => pending.push(resolve));
    },
  };
}

function resolveBunExecutable(): string {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }
  const candidates = [
    process.env.BUN_EXECUTABLE,
    `${homedir()}/.local/share/mise/installs/bun/1.3.13/bin/bun`,
    "bun",
  ];
  const executable = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      (candidate === "bun" ||
        (candidate.endsWith("/bun") && canExecute(candidate))),
  );
  if (executable === undefined) {
    throw new Error("Bun executable is required for runtime lease tests");
  }
  return executable;
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
