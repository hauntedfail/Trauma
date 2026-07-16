import { isIP } from "node:net";

import {
  createPinnedFetch,
  type HostResolver,
  type PinnedAddressFetch,
} from "../importer";
import {
  isBlockedHostname,
  normalizeHostname,
} from "../importer/host-policy";

const DEFAULT_READER_MEDIA_MAX_BYTES = 5_000_000;
const DEFAULT_READER_MEDIA_TIMEOUT_MS = 10_000;
const MAX_READER_MEDIA_REDIRECTS = 5;
const MAX_READER_MEDIA_URL_LENGTH = 8_192;
const READER_MEDIA_ACCEPT = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
].join(", ");
const ALLOWED_READER_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface ReaderMediaRequestOptions {
  fetchAddress?: PinnedAddressFetch;
  maxBytes?: number;
  resolveHostname?: HostResolver;
  timeoutMs?: number;
}

export async function handleReaderMediaRequest(
  request: Request,
  options: ReaderMediaRequestOptions = {},
): Promise<Response> {
  const target = readTargetUrl(request);
  if (target instanceof ReaderMediaError) {
    return errorResponse(target);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_READER_MEDIA_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_READER_MEDIA_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const abortForRequest = () => controller.abort();
  request.signal.addEventListener("abort", abortForRequest, { once: true });
  if (request.signal.aborted) {
    controller.abort();
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const fetchUrl = createPinnedFetch(
      options.resolveHostname,
      options.fetchAddress,
    );
    const response = await fetchWithValidatedRedirects({
      fetchUrl,
      signal: controller.signal,
      url: target,
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new ReaderMediaError(502, "reader media upstream request failed");
    }

    const contentType = readAllowedContentType(response);
    if (contentType === null) {
      await cancelResponseBody(response);
      throw new ReaderMediaError(
        415,
        "reader media response must be a supported raster image",
      );
    }

    const declaredLength = readDeclaredContentLength(response);
    if (declaredLength !== null && declaredLength > maxBytes) {
      await cancelResponseBody(response);
      throw new ReaderMediaError(413, "reader media response is too large");
    }

    const body = await readBoundedResponseBytes(response, maxBytes);
    return new Response(body, {
      headers: {
        "cache-control": "private, max-age=300, no-transform",
        "content-length": String(body.byteLength),
        "content-type": contentType,
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
      },
      status: 200,
    });
  } catch (error) {
    if (error instanceof ReaderMediaError) {
      return errorResponse(error);
    }
    if (timedOut) {
      return errorResponse(
        new ReaderMediaError(504, "reader media request timed out"),
      );
    }
    if (request.signal.aborted) {
      return errorResponse(
        new ReaderMediaError(499, "reader media request was canceled"),
      );
    }
    if (isPublicHostValidationError(error)) {
      return errorResponse(
        new ReaderMediaError(
          400,
          "reader media URL must target a public HTTPS hostname",
        ),
      );
    }
    return errorResponse(
      new ReaderMediaError(502, "reader media upstream request failed"),
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortForRequest);
  }
}

interface FetchValidatedRedirectsInput {
  fetchUrl: ReturnType<typeof createPinnedFetch>;
  signal: AbortSignal;
  url: URL;
}

async function fetchWithValidatedRedirects(
  input: FetchValidatedRedirectsInput,
): Promise<Response> {
  let currentUrl = input.url;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await input.fetchUrl(currentUrl.toString(), {
      credentials: "omit",
      headers: {
        accept: READER_MEDIA_ACCEPT,
      },
      method: "GET",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: input.signal,
    });
    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    await cancelResponseBody(response);
    if (location === null || redirectCount >= MAX_READER_MEDIA_REDIRECTS) {
      throw new ReaderMediaError(502, "reader media redirect was invalid");
    }
    currentUrl = parseTargetUrl(location, currentUrl);
  }
}

function readTargetUrl(request: Request): URL | ReaderMediaError {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return new ReaderMediaError(400, "reader media URL is invalid");
  }

  const values = requestUrl.searchParams.getAll("url");
  const value = values[0];
  if (
    values.length !== 1 ||
    value === undefined ||
    value.trim() === "" ||
    value.length > MAX_READER_MEDIA_URL_LENGTH
  ) {
    return new ReaderMediaError(400, "reader media URL is invalid");
  }

  try {
    return parseTargetUrl(value);
  } catch (error) {
    return error instanceof ReaderMediaError
      ? error
      : new ReaderMediaError(400, "reader media URL is invalid");
  }
}

function parseTargetUrl(value: string, base?: URL): URL {
  if (value.length > MAX_READER_MEDIA_URL_LENGTH) {
    throw new ReaderMediaError(400, "reader media URL is invalid");
  }

  let parsed: URL;
  try {
    parsed = base === undefined ? new URL(value) : new URL(value, base);
  } catch {
    throw new ReaderMediaError(400, "reader media URL is invalid");
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    isIP(hostname) !== 0 ||
    isBlockedHostname(hostname)
  ) {
    throw new ReaderMediaError(
      400,
      "reader media URL must target a public HTTPS hostname",
    );
  }
  parsed.hash = "";
  return parsed;
}

function readAllowedContentType(response: Response): string | null {
  const rawContentType = response.headers.get("content-type");
  if (rawContentType === null) {
    return null;
  }
  const contentType = rawContentType.split(";", 1)[0]?.trim().toLowerCase();
  return contentType !== undefined && ALLOWED_READER_MEDIA_TYPES.has(contentType)
    ? contentType
    : null;
}

function readDeclaredContentLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new ReaderMediaError(413, "reader media response is too large");
    }
    chunks.push(chunk.value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is already closed or canceled.
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 ||
    status === 307 || status === 308;
}

function isPublicHostValidationError(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "url must target a public HTTP(S) host";
}

function errorResponse(error: ReaderMediaError): Response {
  return Response.json(
    { error: error.message },
    {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
      status: error.status,
    },
  );
}

class ReaderMediaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReaderMediaError";
  }
}
