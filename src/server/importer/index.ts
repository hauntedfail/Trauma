import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { readableMarkdownLength, type ArticleExtractor } from "./extractor";
import {
  ArticleExtractionTimeoutError,
  extractArticleInWorker,
  isArticleExtractionTimeout,
  runExtractorWithTimeout,
} from "./extraction-runtime";
import {
  isBlockedHostname,
  isPrivateAddress,
  normalizeHostname,
} from "./host-policy";

export type ImportFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type HostResolver = (hostname: string) => Promise<string[]>;
export type PinnedAddressFetch = (
  url: URL,
  address: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ImportUrlInput {
  url: string;
  fetch?: ImportFetch;
  resolveHostname?: HostResolver;
  extractArticle?: ArticleExtractor;
  maxBytes?: number;
  timeoutMs?: number;
}

export type ImporterResult = ImporterSuccess | LinkOnlyImporterResult;

export interface ImporterSuccess {
  status: "success";
  url: string;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  markdown: string;
}

export interface LinkOnlyImporterResult {
  status: "link_only";
  url: string;
  title: string;
  extractionError: string;
}

const MINIMUM_READABLE_BODY_LENGTH = 80;
const DEFAULT_MAX_IMPORT_BYTES = 2_000_000;
const DEFAULT_IMPORT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export async function importUrl(input: ImportUrlInput): Promise<ImporterResult> {
  const fetchUrl = input.fetch ?? createPinnedFetch(input.resolveHostname);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let normalizedUrl: string;
  try {
    normalizedUrl = await rejectWhenAborted(
      normalizeImportUrl(input.url, {
        resolveHostname: input.resolveHostname,
      }),
      controller.signal,
    );
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      const fallbackUrl = fallbackUrlFromInput(input.url);
      return linkOnly(fallbackUrl, fallbackTitleFromUrl(fallbackUrl), {
        reason: "fetch failed",
        detail: "request timed out",
      });
    }

    throw error;
  }

  let response: Response;
  let currentUrl = normalizedUrl;
  try {
    response = await fetchWithValidatedRedirects({
      url: currentUrl,
      fetchUrl,
      signal: controller.signal,
      resolveHostname: input.resolveHostname,
      setCurrentUrl: (url) => {
        currentUrl = url;
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "fetch failed",
      detail: controller.signal.aborted
        ? "request timed out"
        : formatUnknownError(error),
    });
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    clearTimeout(timeout);
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "fetch failed",
      detail: `HTTP ${response.status}`,
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("html")) {
    await cancelResponseBody(response);
    clearTimeout(timeout);
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "unsupported content type",
      detail: contentType || "missing content-type",
    });
  }

  let boundedBody: Awaited<ReturnType<typeof readBoundedResponseText>>;
  try {
    boundedBody = await readBoundedResponseText(response, {
      maxBytes,
      abort: () => controller.abort(),
    });
  } catch (error) {
    clearTimeout(timeout);
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "fetch failed",
      detail: controller.signal.aborted
        ? "request timed out"
        : formatUnknownError(error),
    });
  }
  if (!boundedBody.ok) {
    clearTimeout(timeout);
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "response too large",
      detail: boundedBody.error,
    });
  }

  let extracted: Awaited<ReturnType<ArticleExtractor>>;
  try {
    const extractionInput = {
      html: boundedBody.text,
      pageUrl: currentUrl,
    };
    const remainingExtractionMs = deadline - Date.now();
    if (remainingExtractionMs <= 0) {
      throw new ArticleExtractionTimeoutError();
    }

    extracted =
      input.extractArticle === undefined
        ? await extractArticleInWorker(extractionInput, remainingExtractionMs)
        : await runExtractorWithTimeout(
            () => input.extractArticle!(extractionInput),
            remainingExtractionMs,
          );
  } catch (error) {
    clearTimeout(timeout);
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "extraction failed",
      detail:
        controller.signal.aborted || isArticleExtractionTimeout(error)
          ? "request timed out"
          : undefined,
    });
  }
  clearTimeout(timeout);
  const title = extracted.title || fallbackTitleFromUrl(currentUrl);

  if (readableMarkdownLength(extracted.markdown) < MINIMUM_READABLE_BODY_LENGTH) {
    return linkOnly(currentUrl, title, {
      reason: "insufficient article body",
    });
  }

  return {
    status: "success",
    url: currentUrl,
    title,
    description: extracted.description,
    faviconUrl: extracted.faviconUrl,
    markdown: extracted.markdown,
  };
}

export async function validateImportUrl(
  url: string,
  options: { resolveHostname?: HostResolver } = {},
) {
  return normalizeImportUrl(url, options);
}

async function readBoundedResponseText(
  response: Response,
  options: { maxBytes: number; abort: () => void },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > options.maxBytes) {
      options.abort();
      return {
        ok: false,
        error: `${parsedLength} bytes exceeds ${options.maxBytes}`,
      };
    }
  }

  if (!response.body) {
    const text = await response.text();
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > options.maxBytes) {
      options.abort();
      return {
        ok: false,
        error: `${byteLength} bytes exceeds ${options.maxBytes}`,
      };
    }

    return { ok: true, text };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const read = await reader.read();
      if (read.done) {
        break;
      }

      bytesRead += read.value.byteLength;
      if (bytesRead > options.maxBytes) {
        options.abort();
        await reader.cancel();
        return {
          ok: false,
          error: `${bytesRead} bytes exceeds ${options.maxBytes}`,
        };
      }

      chunks.push(decoder.decode(read.value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  chunks.push(decoder.decode());
  return { ok: true, text: chunks.join("") };
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup for fallback paths; the import result should still be link-only.
  }
}

async function normalizeImportUrl(
  url: string,
  options: { resolveHostname?: HostResolver } = {},
) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url must be an absolute HTTP(S) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http: or https:");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("url must not include userinfo");
  }

  await assertPublicHostname(parsed.hostname, options.resolveHostname);

  return parsed.toString();
}

async function fetchWithValidatedRedirects(input: {
  url: string;
  fetchUrl: ImportFetch;
  signal: AbortSignal;
  resolveHostname?: HostResolver;
  setCurrentUrl: (url: string) => void;
}) {
  let currentUrl = input.url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    input.setCurrentUrl(currentUrl);
    const response = await rejectWhenAborted(
      input.fetchUrl(currentUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
        },
        redirect: "manual",
        signal: input.signal,
      }),
      input.signal,
    );

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    await response.body?.cancel();

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("redirect response missing Location header");
    }

    currentUrl = await rejectWhenAborted(
      normalizeImportUrl(new URL(location, currentUrl).toString(), {
        resolveHostname: input.resolveHostname,
      }),
      input.signal,
    );
  }

  throw new Error("too many redirects");
}

function isRedirectStatus(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}

function fallbackTitleFromUrl(url: string) {
  const parsed = new URL(url);
  return parsed.hostname || url;
}

function fallbackUrlFromInput(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return url;
  }
}

function linkOnly(
  url: string,
  title: string,
  error: { reason: string; detail?: string },
): LinkOnlyImporterResult {
  return {
    status: "link_only",
    url,
    title,
    extractionError: error.detail
      ? `${error.reason}: ${error.detail}`
      : error.reason,
  };
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rejectWhenAborted<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(new Error("request aborted"));
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(new Error("request aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function assertPublicHostname(
  hostname: string,
  resolveHostname = resolveHostnameAddresses,
) {
  if (isBlockedHostname(hostname)) {
    throw new Error("url must target a public HTTP(S) host");
  }

  const normalizedHostname = normalizeHostname(hostname);
  if (isIP(normalizedHostname) !== 0) {
    return;
  }

  const addresses = await resolveHostname(normalizedHostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateAddress(address))
  ) {
    throw new Error("url must target a public HTTP(S) host");
  }
}

export function createPinnedFetch(
  resolveHostname?: HostResolver,
  fetchAddress: PinnedAddressFetch = fetchPinnedAddress,
): ImportFetch {
  return async (input, init) => {
    const parsed = new URL(input);
    const normalizedHostname = normalizeHostname(parsed.hostname);
    const addresses =
      isIP(normalizedHostname) === 0
        ? await resolvePublicAddressesForFetch(
            normalizedHostname,
            resolveHostname,
            init?.signal ?? undefined,
          )
        : [normalizedHostname];

    let lastError: unknown;
    for (const address of addresses) {
      if (isPrivateAddress(address)) {
        throw new Error("url must target a public HTTP(S) host");
      }

      try {
        return await fetchAddress(parsed, address, init);
      } catch (error) {
        if (init?.signal?.aborted) {
          throw error;
        }

        lastError = error;
      }
    }

    throw lastError ?? new Error("url must target a public HTTP(S) host");
  };
}

async function resolvePublicAddresses(hostname: string, resolveHostname?: HostResolver) {
  const addresses = await (resolveHostname ?? resolveHostnameAddresses)(hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateAddress(address))
  ) {
    throw new Error("url must target a public HTTP(S) host");
  }

  return addresses;
}

async function resolvePublicAddressesForFetch(
  hostname: string,
  resolveHostname: HostResolver | undefined,
  signal: AbortSignal | undefined,
) {
  const operation = resolvePublicAddresses(hostname, resolveHostname);
  return signal ? rejectWhenAborted(operation, signal) : operation;
}

function fetchPinnedAddress(
  url: URL,
  address: string,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const request = (isHttps ? requestHttps : requestHttp)(
      {
        protocol: url.protocol,
        hostname: address,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? "GET",
        headers: {
          ...headersToRecord(init?.headers),
          "accept-encoding": "identity",
          host: url.host,
        },
        servername: url.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(null, address, isIP(address) === 6 ? 6 : 4);
        },
      },
      (incoming) => {
        resolve(
          new Response(
            Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>,
            {
              status: incoming.statusCode ?? 0,
              statusText: incoming.statusMessage,
              headers: incomingHeadersToHeaders(incoming.headers),
            },
          ),
        );
      },
    );

    const signal = init?.signal;
    request.on("error", reject);

    if (signal) {
      if (signal.aborted) {
        const error = new Error("request aborted");
        request.destroy(error);
        reject(error);
        return;
      }

      signal.addEventListener(
        "abort",
        () => request.destroy(new Error("request aborted")),
        { once: true },
      );
    }

    request.end();
  });
}

function headersToRecord(headers: HeadersInit | undefined) {
  if (!headers) {
    return {};
  }

  return Object.fromEntries(new Headers(headers).entries());
}

function incomingHeadersToHeaders(headers: Record<string, string | string[] | undefined>) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        result.append(name, entry);
      }
      continue;
    }

    if (value !== undefined) {
      result.set(name, value);
    }
  }

  return result;
}

async function resolveHostnameAddresses(hostname: string) {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map((address) => address.address);
  } catch {
    return [];
  }
}
