import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export type ImportFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type HostResolver = (hostname: string) => Promise<string[]>;

export interface ImportUrlInput {
  url: string;
  fetch?: ImportFetch;
  resolveHostname?: HostResolver;
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
  const normalizedUrl = await normalizeImportUrl(input.url, {
    resolveHostname: input.resolveHostname,
  });
  const fetchUrl = input.fetch ?? createPinnedFetch(input.resolveHostname);
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS,
  );

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
  clearTimeout(timeout);
  if (!boundedBody.ok) {
    return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
      reason: "response too large",
      detail: boundedBody.error,
    });
  }

  const html = boundedBody.text;
  const extracted = extractReadableArticle(html, currentUrl);
  const title = extracted.title || fallbackTitleFromUrl(currentUrl);

  if (readableLength(extracted.markdown) < MINIMUM_READABLE_BODY_LENGTH) {
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

interface ExtractedArticle {
  title: string;
  description: string | null;
  faviconUrl: string | null;
  markdown: string;
}

function extractReadableArticle(html: string, pageUrl: string): ExtractedArticle {
  const title =
    findMetaContent(html, "property", "og:title") ??
    findMetaContent(html, "name", "twitter:title") ??
    findTitle(html);
  const description =
    findMetaContent(html, "name", "description") ??
    findMetaContent(html, "property", "og:description");
  const faviconUrl = findFaviconUrl(html, pageUrl);
  const articleHtml =
    findFirstElementContent(html, "article") ?? findBody(html) ?? html;
  const markdown = htmlFragmentToMarkdown(articleHtml, pageUrl, title);

  return {
    title,
    description,
    faviconUrl,
    markdown,
  };
}

function htmlFragmentToMarkdown(
  html: string,
  pageUrl: string,
  title: string,
): string {
  let content = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "");

  content = content.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = readHtmlAttribute(tag, "src");
    if (!src) {
      return "";
    }

    const alt = readHtmlAttribute(tag, "alt") ?? "";
    const resolvedSrc = resolveSafeDisplayUrl(pageUrl, src);
    if (!resolvedSrc) {
      return "";
    }

    return `\n![${escapeMarkdownText(decodeHtmlEntities(alt))}](${formatMarkdownDestination(resolvedSrc)})\n`;
  });

  content = content.replace(
    /<a\b[^>]*href=(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, labelHtml: string) => {
      const label = normalizeInlineText(stripHtml(labelHtml));
      if (label.length === 0) {
        return "";
      }

      const resolvedHref = resolveSafeDisplayUrl(pageUrl, href);
      if (!resolvedHref) {
        return label;
      }

      return `[${escapeMarkdownText(label)}](${formatMarkdownDestination(resolvedHref)})`;
    },
  );

  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    const headingPattern = new RegExp(
      `<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`,
      "gi",
    );
    content = content.replace(headingPattern, (_match, headingHtml: string) => {
      const heading = normalizeInlineText(stripHtml(headingHtml));
      return heading.length > 0 ? `\n${"#".repeat(level)} ${heading}\n` : "\n";
    });
  }

  content = content
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<(p|div|section|main|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|main|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "");

  const lines = decodeHtmlEntities(content)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);
  const markdown = lines.join("\n\n");

  if (title.length > 0 && !markdown.startsWith("# ")) {
    return `# ${escapeMarkdownText(title)}\n\n${markdown}`.trim();
  }

  return markdown;
}

function findMetaContent(
  html: string,
  attribute: "name" | "property",
  expectedValue: string,
) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const value = readHtmlAttribute(tag, attribute);
    if (value?.toLowerCase() === expectedValue.toLowerCase()) {
      const content = readHtmlAttribute(tag, "content");
      if (content && content.trim() !== "") {
        return decodeHtmlEntities(content.trim());
      }
    }
  }

  return null;
}

function findFaviconUrl(html: string, pageUrl: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = readHtmlAttribute(tag, "rel");
    if (!rel?.toLowerCase().split(/\s+/).includes("icon")) {
      continue;
    }

    const href = readHtmlAttribute(tag, "href");
    if (href && href.trim() !== "") {
      return resolveSafeDisplayUrl(pageUrl, href.trim());
    }
  }

  return null;
}

function findTitle(html: string) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? normalizeInlineText(stripHtml(match[1])) : "";
}

function findBody(html: string) {
  return findFirstElementContent(html, "body");
}

function findFirstElementContent(html: string, tagName: string) {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  return pattern.exec(html)?.[1] ?? null;
}

function stripHtml(html: string) {
  return html.replace(/<\/?[^>]+>/g, "");
}

function normalizeInlineText(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function readableLength(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]+]\([^)]+\)/g, "")
    .replace(/[#*_`>\-[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

function readHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeMarkdownText(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
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

function resolveSafeDisplayUrl(pageUrl: string, value: string) {
  try {
    const parsed = new URL(value, pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return isBlockedHostname(parsed.hostname) ? null : parsed.toString();
  } catch {
    return null;
  }
}

function formatMarkdownDestination(url: string) {
  return url.replace(/\\/g, "%5C").replace(/\)/g, "\\)");
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
    const response = await input.fetchUrl(currentUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: input.signal,
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    await response.body?.cancel();

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("redirect response missing Location header");
    }

    currentUrl = await normalizeImportUrl(new URL(location, currentUrl).toString(), {
      resolveHostname: input.resolveHostname,
    });
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

function createPinnedFetch(resolveHostname?: HostResolver): ImportFetch {
  return async (input, init) => {
    const parsed = new URL(input);
    const normalizedHostname = normalizeHostname(parsed.hostname);
    const address =
      isIP(normalizedHostname) === 0
        ? await resolvePublicAddress(normalizedHostname, resolveHostname)
        : normalizedHostname;

    if (isPrivateAddress(address)) {
      throw new Error("url must target a public HTTP(S) host");
    }

    return fetchPinnedAddress(parsed, address, init);
  };
}

async function resolvePublicAddress(hostname: string, resolveHostname?: HostResolver) {
  const addresses = await (resolveHostname ?? resolveHostnameAddresses)(hostname);
  if (
    addresses.length === 0 ||
    addresses.some((address) => isPrivateAddress(address))
  ) {
    throw new Error("url must target a public HTTP(S) host");
  }

  return addresses[0] ?? hostname;
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
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error("request aborted"));
        return;
      }

      signal.addEventListener(
        "abort",
        () => request.destroy(new Error("request aborted")),
        { once: true },
      );
    }

    request.on("error", reject);
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

function isBlockedHostname(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    normalizedHostname === "" ||
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".local")
  ) {
    return true;
  }

  return isPrivateAddress(normalizedHostname);
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isPrivateAddress(address: string) {
  const normalizedAddress = normalizeHostname(address);
  const ipVersion = isIP(normalizedAddress);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalizedAddress);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(normalizedAddress);
  }

  return false;
}

function isPrivateIpv4(address: string) {
  const octets = parseIpv4Octets(address);
  if (!octets) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string) {
  const words = parseIpv6Words(address);
  if (!words) {
    return true;
  }

  const embeddedIpv4 = ipv4FromMappedIpv6(words);
  if (embeddedIpv4 && isPrivateIpv4(embeddedIpv4)) {
    return true;
  }

  const first = words[0] ?? 0;
  return (
    words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) ||
    (first & 0xff00) === 0xff00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xe000) !== 0x2000 ||
    (first === 0x2001 && words[1] === 0x0db8)
  );
}

function parseIpv4Octets(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return null;
  }

  return octets as [number, number, number, number];
}

function parseIpv6Words(address: string) {
  const withoutZone = address.split("%", 1)[0] ?? "";
  const sections = withoutZone.split("::");
  if (sections.length > 2) {
    return null;
  }

  const left = parseIpv6Section(sections[0] ?? "");
  const right = parseIpv6Section(sections[1] ?? "");
  if (!left || !right) {
    return null;
  }

  if (sections.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return null;
  }

  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function parseIpv6Section(section: string) {
  if (section === "") {
    return [];
  }

  const words: number[] = [];
  const parts = section.split(":");
  for (const part of parts) {
    if (part.includes(".")) {
      const octets = parseIpv4Octets(part);
      if (!octets) {
        return null;
      }

      words.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
      continue;
    }

    const word = Number.parseInt(part, 16);
    if (
      part === "" ||
      part.length > 4 ||
      !/^[0-9a-f]+$/i.test(part) ||
      !Number.isInteger(word) ||
      word < 0 ||
      word > 0xffff
    ) {
      return null;
    }

    words.push(word);
  }

  return words;
}

function ipv4FromMappedIpv6(words: number[]) {
  if (
    words.length === 8 &&
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    return [
      high >> 8,
      high & 0xff,
      low >> 8,
      low & 0xff,
    ].join(".");
  }

  return null;
}
