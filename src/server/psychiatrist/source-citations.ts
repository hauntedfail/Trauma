import type { PsychiatristSourceCitation } from "./types";

const MAX_CITATIONS = 8;
const MAX_TITLE_CHARS = 160;
const MAX_URL_CHARS = 2048;

export function sanitizePsychiatristSourceCitations(
  citations: readonly PsychiatristSourceCitation[] | undefined,
): PsychiatristSourceCitation[] {
  if (citations === undefined) {
    return [];
  }
  const safe: PsychiatristSourceCitation[] = [];
  for (const citation of citations) {
    if (safe.length >= MAX_CITATIONS) {
      break;
    }
    const url = sanitizeSourceUrl(citation.url);
    if (url === undefined) {
      continue;
    }
    safe.push({
      sourceId: `source-${safe.length + 1}`,
      title: sanitizeSourceTitle(citation.title),
      url,
    });
  }
  return safe;
}

function sanitizeSourceUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }
  if (isUnsafeCitationHost(url.hostname)) {
    return undefined;
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const projected = url.toString();
  return projected.length > MAX_URL_CHARS ? undefined : projected;
}

function isUnsafeCitationHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (ipv4 !== undefined) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const ipv6 = host.replace(/^\[/, "").replace(/\]$/, "");
  return ipv6 === "::1" ||
    ipv6.startsWith("fc") ||
    ipv6.startsWith("fd") ||
    ipv6.startsWith("fe8") ||
    ipv6.startsWith("fe9") ||
    ipv6.startsWith("fea") ||
    ipv6.startsWith("feb");
}

function parseIpv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }
    return Number(part);
  });
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return undefined;
  }
  return octets as [number, number, number, number];
}

function sanitizeSourceTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  return title === "" ? "Source" : title;
}
