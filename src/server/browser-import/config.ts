export interface BrowserImportConfig {
  enabled: boolean;
  token: string | null;
  allowedOrigins: readonly string[];
  maxBytes: number;
}

export type BrowserImportConfigEnv = Record<string, string | undefined>;

const DEFAULT_BROWSER_IMPORT_MAX_BYTES = 5_000_000;
const MIN_BROWSER_IMPORT_MAX_BYTES = 100_000;
const MAX_BROWSER_IMPORT_MAX_BYTES = 20_000_000;

export function loadBrowserImportConfig(
  env: BrowserImportConfigEnv = process.env,
): BrowserImportConfig {
  return {
    enabled: env.TRAUMA_BROWSER_IMPORT_ENABLED === "true",
    token: normalizeOptionalText(env.TRAUMA_BROWSER_IMPORT_TOKEN),
    allowedOrigins: parseAllowedOrigins(
      env.TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS,
    ),
    maxBytes: parseMaxBytes(env.TRAUMA_BROWSER_IMPORT_MAX_BYTES),
  };
}

export function isBrowserImportOriginAllowed(
  origin: string | null,
  config: BrowserImportConfig,
) {
  if (origin === null || origin.trim() === "") {
    return false;
  }

  const normalized = origin.trim();
  if (!normalized.startsWith("chrome-extension://")) {
    return false;
  }

  if (config.allowedOrigins.length > 0) {
    return config.allowedOrigins.includes(normalized);
  }

  return normalized.startsWith("chrome-extension://");
}

function parseAllowedOrigins(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseMaxBytes(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_BROWSER_IMPORT_MAX_BYTES;
  }

  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    parsed < MIN_BROWSER_IMPORT_MAX_BYTES ||
    parsed > MAX_BROWSER_IMPORT_MAX_BYTES
  ) {
    return DEFAULT_BROWSER_IMPORT_MAX_BYTES;
  }

  return parsed;
}

function normalizeOptionalText(value: string | undefined) {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
