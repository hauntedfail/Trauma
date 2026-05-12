export interface BrowserImportPayload {
  sourceUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  articleHtml: string;
  articleText: string;
  selector: string;
  extractionStrategy: BrowserImportExtractionStrategy;
  capturedAt: string;
  extensionVersion: string;
}

export type BrowserImportExtractionStrategy =
  | "site_selector"
  | "semantic_selector"
  | "body_fallback";

export type BrowserImportPayloadResult =
  | { ok: true; payload: BrowserImportPayload }
  | { ok: false; error: string };

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_SELECTOR_LENGTH = 300;
const MAX_EXTENSION_VERSION_LENGTH = 64;
const CAPTURE_CLOCK_SKEW_MS = 10 * 60 * 1_000;

export function parseBrowserImportPayload(
  body: string,
  options: { maxBytes: number; now?: () => Date },
): BrowserImportPayloadResult {
  if (new TextEncoder().encode(body).byteLength > options.maxBytes) {
    return { ok: false, error: "request body is too large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: "request body must be an object" };
  }

  const allowedKeys = new Set([
    "sourceUrl",
    "canonicalUrl",
    "title",
    "description",
    "articleHtml",
    "articleText",
    "selector",
    "extractionStrategy",
    "capturedAt",
    "extensionVersion",
  ]);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `unexpected field: ${key}` };
    }
  }

  const sourceUrl = normalizeHttpUrl(parsed.sourceUrl, "sourceUrl");
  if (!sourceUrl.ok) {
    return { ok: false, error: sourceUrl.error };
  }

  const canonicalUrl =
    parsed.canonicalUrl === undefined || parsed.canonicalUrl === null
      ? { ok: true as const, value: null }
      : normalizeHttpUrl(parsed.canonicalUrl, "canonicalUrl");
  if (!canonicalUrl.ok) {
    return { ok: false, error: canonicalUrl.error };
  }

  const title = normalizeOptionalString(parsed.title, {
    field: "title",
    maxLength: MAX_TITLE_LENGTH,
  });
  if (!title.ok) {
    return { ok: false, error: title.error };
  }

  const description = normalizeOptionalString(parsed.description, {
    field: "description",
    maxLength: MAX_DESCRIPTION_LENGTH,
  });
  if (!description.ok) {
    return { ok: false, error: description.error };
  }

  const articleHtml = normalizeRequiredString(parsed.articleHtml, {
    field: "articleHtml",
    maxLength: options.maxBytes,
  });
  if (!articleHtml.ok) {
    return { ok: false, error: articleHtml.error };
  }
  if (new TextEncoder().encode(articleHtml.value).byteLength > options.maxBytes) {
    return { ok: false, error: "articleHtml is too large" };
  }

  const articleText = normalizeRequiredString(parsed.articleText, {
    field: "articleText",
    maxLength: options.maxBytes,
  });
  if (!articleText.ok) {
    return { ok: false, error: articleText.error };
  }
  if (new TextEncoder().encode(articleText.value).byteLength > options.maxBytes) {
    return { ok: false, error: "articleText is too large" };
  }

  const selector = normalizeRequiredString(parsed.selector, {
    field: "selector",
    maxLength: MAX_SELECTOR_LENGTH,
  });
  if (!selector.ok) {
    return { ok: false, error: selector.error };
  }

  const extractionStrategy = normalizeExtractionStrategy(
    parsed.extractionStrategy,
  );
  if (!extractionStrategy.ok) {
    return { ok: false, error: extractionStrategy.error };
  }

  const capturedAt = normalizeCapturedAt(parsed.capturedAt, options.now);
  if (!capturedAt.ok) {
    return { ok: false, error: capturedAt.error };
  }

  const extensionVersion = normalizeRequiredString(parsed.extensionVersion, {
    field: "extensionVersion",
    maxLength: MAX_EXTENSION_VERSION_LENGTH,
  });
  if (!extensionVersion.ok) {
    return { ok: false, error: extensionVersion.error };
  }

  return {
    ok: true,
    payload: {
      sourceUrl: sourceUrl.value,
      canonicalUrl: canonicalUrl.value,
      title: title.value,
      description: description.value,
      articleHtml: articleHtml.value,
      articleText: articleText.value,
      selector: selector.value,
      extractionStrategy: extractionStrategy.value,
      capturedAt: capturedAt.value,
      extensionVersion: extensionVersion.value,
    },
  };
}

function normalizeHttpUrl(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false as const, error: `${field} must be an absolute URL` };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false as const, error: `${field} must be an absolute URL` };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false as const, error: `${field} must use http or https` };
  }

  if (url.username !== "" || url.password !== "") {
    return { ok: false as const, error: `${field} must not include userinfo` };
  }

  return { ok: true as const, value: url.toString() };
}

function normalizeOptionalString(
  value: unknown,
  options: { field: string; maxLength: number },
) {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false as const, error: `${options.field} must be a string` };
  }

  const normalized = value.trim();
  if (normalized.length > options.maxLength) {
    return {
      ok: false as const,
      error: `${options.field} must be at most ${options.maxLength} characters`,
    };
  }

  return { ok: true as const, value: normalized.length > 0 ? normalized : null };
}

function normalizeRequiredString(
  value: unknown,
  options: { field: string; maxLength: number },
) {
  if (typeof value !== "string" || value.trim() === "") {
    return {
      ok: false as const,
      error: `${options.field} must be a non-empty string`,
    };
  }

  const normalized = value.trim();
  if (normalized.length > options.maxLength) {
    return {
      ok: false as const,
      error: `${options.field} must be at most ${options.maxLength} characters`,
    };
  }

  return { ok: true as const, value: normalized };
}

function normalizeExtractionStrategy(value: unknown) {
  if (
    value === "site_selector" ||
    value === "semantic_selector" ||
    value === "body_fallback"
  ) {
    return { ok: true as const, value: value as BrowserImportExtractionStrategy };
  }

  return {
    ok: false as const,
    error:
      "extractionStrategy must be site_selector, semantic_selector, or body_fallback",
  };
}

function normalizeCapturedAt(value: unknown, now: (() => Date) | undefined) {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false as const, error: "capturedAt must be an ISO timestamp" };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false as const, error: "capturedAt must be an ISO timestamp" };
  }

  const reference = now?.() ?? new Date();
  if (Math.abs(reference.getTime() - parsed.getTime()) > CAPTURE_CLOCK_SKEW_MS) {
    return {
      ok: false as const,
      error: "capturedAt must be within 10 minutes of server time",
    };
  }

  return { ok: true as const, value: parsed.toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
