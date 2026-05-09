/**
 * Dev startup smoke check.
 *
 * Boots `vinxi dev` with a deterministic host and port and an ephemeral
 * Trauma config, probes `/memories`, then shuts the server down. Exits
 * non-zero if the server fails to bind, exits early, or never serves a
 * 2xx/3xx/4xx response within the timeout.
 */

import { spawn } from "node:child_process";

interface SmokeOptions {
  readonly host: string;
  readonly port: number;
  readonly hmrPort: number;
  readonly path: string;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

function buildOptions(): SmokeOptions {
  return {
    host: readString("TRAUMA_DEV_HOST", "localhost"),
    port: readNumber("TRAUMA_DEV_PORT", 3000),
    hmrPort: readNumber("TRAUMA_HMR_PORT", 24678),
    path: readString("TRAUMA_DEV_SMOKE_PATH", "/memories"),
    timeoutMs: readNumber("TRAUMA_DEV_SMOKE_TIMEOUT_MS", 90_000),
    pollIntervalMs: readNumber("TRAUMA_DEV_SMOKE_POLL_MS", 500),
  };
}

async function probe(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, { signal });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function waitForReady(
  url: string,
  timeoutMs: number,
  pollIntervalMs: number,
  exitedRef: { exited: boolean },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitedRef.exited) {
      throw new Error("Dev server exited before becoming ready");
    }
    const controller = new AbortController();
    const probeTimer = setTimeout(
      () => controller.abort(),
      Math.min(pollIntervalMs * 4, 5_000),
    );
    const ok = await probe(url, controller.signal);
    clearTimeout(probeTimer);
    if (ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Dev server did not respond within ${timeoutMs}ms`);
}

async function run(options: SmokeOptions): Promise<void> {
  const url = `http://${options.host}:${options.port}${options.path}`;
  // eslint-disable-next-line no-console
  console.log(`[dev-smoke] starting ${url} (hmr ${options.hmrPort})`);

  const child = spawn(
    "bun",
    ["x", "vinxi", "dev", "--port", String(options.port)],
    {
      env: {
        ...process.env,
        HOST: options.host,
        PORT: String(options.port),
        TRAUMA_HMR_PORT: String(options.hmrPort),
        TRAUMA_BROWSE_FIXTURES: "1",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  const exitedRef = { exited: false };
  let earlyExitCode: number | null = null;

  child.on("exit", (code) => {
    exitedRef.exited = true;
    earlyExitCode = code;
  });

  try {
    await waitForReady(
      url,
      options.timeoutMs,
      options.pollIntervalMs,
      exitedRef,
    );
    // eslint-disable-next-line no-console
    console.log(`[dev-smoke] ${url} responded ok`);
  } finally {
    if (!exitedRef.exited) {
      child.kill("SIGTERM");
      const killed = await new Promise<boolean>((resolve) => {
        const fallback = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(false);
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(fallback);
          resolve(true);
        });
      });
      if (!killed) {
        // eslint-disable-next-line no-console
        console.warn("[dev-smoke] dev server required SIGKILL");
      }
    }
  }

  if (earlyExitCode !== null && earlyExitCode !== 0) {
    throw new Error(`Dev server exited with code ${earlyExitCode}`);
  }
}

run(buildOptions()).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  // eslint-disable-next-line no-console
  console.error(`[dev-smoke] FAIL ${message}`);
  process.exit(1);
});
