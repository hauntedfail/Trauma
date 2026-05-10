/**
 * Dev startup smoke check.
 *
 * Boots `vinxi dev` with a deterministic host and port and probes
 * `/memories` in fixtures mode, then shuts the server down. Exits
 * non-zero if the requested port is occupied, the server cannot
 * bind, the server exits early, the server falls back to a different
 * port, or the probe never succeeds within the timeout.
 */

import { spawn } from "node:child_process";
import { createServer, isIP } from "node:net";

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
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function readPort(name: string, fallback: number): number {
  const value = readNumber(name, fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid ${name}: ${value} (expected integer in 1..65535)`);
  }
  return value;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.length > 0 ? raw : fallback;
}

function readFirstString(names: ReadonlyArray<string>, fallback: string): string {
  for (const name of names) {
    const raw = process.env[name];
    if (raw && raw.length > 0) {
      return raw;
    }
  }
  return fallback;
}

function readFirstPort(names: ReadonlyArray<string>, fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (raw !== undefined && raw.trim() !== "") {
      return readPort(name, fallback);
    }
  }
  return fallback;
}

function buildOptions(): SmokeOptions {
  return {
    host: readFirstString(["TRAUMA_DEV_HOST", "HOST"], "127.0.0.1"),
    port: readFirstPort(["TRAUMA_DEV_PORT", "PORT"], 3000),
    hmrPort: readPort("TRAUMA_HMR_PORT", 24678),
    path: readString("TRAUMA_DEV_SMOKE_PATH", "/memories"),
    timeoutMs: readNumber("TRAUMA_DEV_SMOKE_TIMEOUT_MS", 90_000),
    pollIntervalMs: readNumber("TRAUMA_DEV_SMOKE_POLL_MS", 500),
  };
}

function bracketHost(host: string): string {
  if (isIP(host) === 6 && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

function buildProbeUrl(options: SmokeOptions): string {
  return `http://${bracketHost(options.host)}:${options.port}${options.path}`;
}

async function ensurePortFree(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `Port ${port} on host ${host} is already in use (${error.code ?? error.message})`,
        ),
      );
    });
    server.listen(port, host, () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
        } else {
          resolve();
        }
      });
    });
  });
}

async function probe(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, { signal });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

interface SmokeProcessState {
  exited: boolean;
  fallbackDetected: boolean;
}

const FALLBACK_PATTERNS: ReadonlyArray<RegExp> = [
  /\[get-port\][^\n]*Unable to find/i,
  /Using alternative port/i,
  /Unable to find a random port/i,
];

function watchForFallback(
  chunk: Buffer | string,
  state: SmokeProcessState,
): void {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  if (FALLBACK_PATTERNS.some((pattern) => pattern.test(text))) {
    state.fallbackDetected = true;
  }
}

async function waitForReady(
  url: string,
  timeoutMs: number,
  pollIntervalMs: number,
  state: SmokeProcessState,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.exited) {
      throw new Error("Dev server exited before becoming ready");
    }
    if (state.fallbackDetected) {
      throw new Error(
        "Dev server fell back to a different port (see captured output above)",
      );
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
  const url = buildProbeUrl(options);
  // eslint-disable-next-line no-console
  console.log(`[dev-smoke] starting ${url} (hmr ${options.hmrPort})`);

  await ensurePortFree(options.host, options.port);

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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const state: SmokeProcessState = { exited: false, fallbackDetected: false };
  let earlyExitCode: number | null = null;

  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    watchForFallback(chunk, state);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    watchForFallback(chunk, state);
  });
  child.on("exit", (code) => {
    state.exited = true;
    earlyExitCode = code;
  });

  try {
    await waitForReady(url, options.timeoutMs, options.pollIntervalMs, state);
    // eslint-disable-next-line no-console
    console.log(`[dev-smoke] ${url} responded ok`);
  } finally {
    if (!state.exited) {
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
