import ipaddr from "ipaddr.js";

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
  const address = parseIpAddress(host);
  return address === undefined ? false : address.range() !== "unicast";
}

function parseIpAddress(host: string): ReturnType<typeof ipaddr.process> | undefined {
  const candidate = host.replace(/^\[/, "").replace(/\]$/, "");
  try {
    return ipaddr.process(candidate);
  } catch {
    return undefined;
  }
}

function sanitizeSourceTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  return title === "" ? "Source" : title;
}
