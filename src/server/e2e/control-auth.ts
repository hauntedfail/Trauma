import { createHash, timingSafeEqual } from "node:crypto";

import {
  E2E_CONFIG_PATH,
  E2E_CONTROL_MAX_TOKEN_BYTES,
  E2E_CONTROL_MIN_TOKEN_BYTES,
  E2E_CONTROL_TOKEN_HEADER,
} from "./control-types";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

export type E2eControlEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function isAuthorizedE2eControlRequest(
  request: Request,
  env: E2eControlEnvironment,
): boolean {
  if (
    env.TRAUMA_E2E_CONTROL !== "1" ||
    env.TRAUMA_BROWSE_FIXTURES !== "1" ||
    env.TRAUMA_E2E_IMPORT_FIXTURES !== "1" ||
    env.TRAUMA_CONFIG_PATH !== E2E_CONFIG_PATH ||
    !isLoopbackRequest(request)
  ) {
    return false;
  }

  const expectedToken = env.TRAUMA_E2E_CONTROL_TOKEN;
  if (!hasValidConfiguredTokenLength(expectedToken)) {
    return false;
  }

  const actualToken = request.headers.get(E2E_CONTROL_TOKEN_HEADER) ?? "";
  return timingSafeEqual(hashToken(expectedToken), hashToken(actualToken));
}

function isLoopbackRequest(request: Request): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  if (!LOOPBACK_HOSTNAMES.has(normalizeHostname(url.hostname))) {
    return false;
  }

  const host = request.headers.get("host");
  if (host === null) {
    return false;
  }

  try {
    const parsedHost = new URL(`http://${host}`);
    return (
      parsedHost.username === "" &&
      parsedHost.password === "" &&
      parsedHost.pathname === "/" &&
      parsedHost.search === "" &&
      parsedHost.hash === "" &&
      LOOPBACK_HOSTNAMES.has(normalizeHostname(parsedHost.hostname))
    );
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
}

function hasValidConfiguredTokenLength(token: string | undefined): token is string {
  if (token === undefined) {
    return false;
  }
  const bytes = Buffer.byteLength(token, "utf8");
  return bytes >= E2E_CONTROL_MIN_TOKEN_BYTES &&
    bytes <= E2E_CONTROL_MAX_TOKEN_BYTES;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
