import { isIP } from "node:net";

import { isBlockedHostname, normalizeHostname } from "./importer/host-policy";

export const READER_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

export function resolveSafeImageUrl(pageUrl: string, value: string): string | null {
  return resolveSafePublicHttpsUrl(pageUrl, value);
}

export function resolveSafeIframeUrl(pageUrl: string, value: string): string | null {
  return resolveSafePublicHttpsUrl(pageUrl, value);
}

export function isSafeReaderIframeUrl(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return isSafePublicHttpsUrl(parsed);
  } catch {
    return false;
  }
}

export function resolveTrustedDisplayUrl(
  pageUrl: string,
  value: string,
): string | null {
  try {
    const parsed = new URL(decodeUrlAttributeEntities(value), pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }

    if (!isTrustedDisplayHostname(pageUrl, parsed.hostname)) {
      return null;
    }

    parsed.username = "";
    parsed.password = "";

    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveSafePublicHttpsUrl(pageUrl: string, value: string): string | null {
  try {
    const parsed = new URL(decodeUrlAttributeEntities(value), pageUrl);
    if (!isSafePublicHttpsUrl(parsed)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function isSafePublicHttpsUrl(parsed: URL): boolean {
  return (
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    isIP(normalizeHostname(parsed.hostname)) === 0 &&
    !isBlockedHostname(parsed.hostname)
  );
}

function isTrustedDisplayHostname(pageUrl: string, hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  try {
    return normalizedHostname === normalizeHostname(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

function decodeUrlAttributeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&");
}
