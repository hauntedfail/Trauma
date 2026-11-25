import { createHash, timingSafeEqual } from "node:crypto";

export const TRAUMA_API_TOKEN_ENV_VAR = "TRAUMA_API_TOKEN";

export type ApiAuthResult =
  | { ok: true; authenticated: boolean }
  | { ok: false; error: string; status: 401 };

export type ExtractedBearerToken =
  | { present: false }
  | { present: true; token: string };

const BEARER_HEADER_PATTERN = /^bearer(?:\s+(.*))?$/i;

export function readConfiguredApiToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[TRAUMA_API_TOKEN_ENV_VAR];
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractBearerToken(request: Request): ExtractedBearerToken {
  const header = request.headers.get("authorization");
  if (header === null) {
    return { present: false };
  }

  const match = BEARER_HEADER_PATTERN.exec(header.trim());
  if (match === null) {
    return { present: false };
  }

  return {
    present: true,
    token: (match[1] ?? "").trim(),
  };
}

/**
 * Compares a presented API token against the configured token in constant time
 * by comparing SHA-256 digests so token length is never leaked via timing.
 */
export function verifyApiToken(
  presentedToken: string,
  configuredToken: string,
): boolean {
  if (presentedToken.length === 0 || configuredToken.length === 0) {
    return false;
  }

  const presentedHash = hashToken(presentedToken);
  const configuredHash = hashToken(configuredToken);
  return timingSafeEqual(presentedHash, configuredHash);
}

/**
 * Validates optional Authorization: Bearer token authentication against
 * TRAUMA_API_TOKEN.
 *
 * - When TRAUMA_API_TOKEN is not configured, returns unauthenticated (ok: true)
 *   so local browser and reverse-proxy setups remain backward-compatible.
 * - When TRAUMA_API_TOKEN is configured and no Bearer header is sent, returns
 *   unauthenticated (ok: true) so browser CSRF/Cloudflare Access flows continue
 *   unchanged.
 * - When TRAUMA_API_TOKEN is configured and a Bearer header is presented,
 *   validates it in constant time and returns 401 on mismatch.
 */
export function authenticateApiRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): ApiAuthResult {
  const configuredToken = readConfiguredApiToken(env);
  if (configuredToken === undefined) {
    return { ok: true, authenticated: false };
  }

  const bearer = extractBearerToken(request);
  if (!bearer.present) {
    return { ok: true, authenticated: false };
  }

  if (!verifyApiToken(bearer.token, configuredToken)) {
    return {
      ok: false,
      error: "invalid API token",
      status: 401,
    };
  }

  return { ok: true, authenticated: true };
}

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
