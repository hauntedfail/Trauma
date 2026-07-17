import ipaddr from "ipaddr.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function isPsychiatristSourceCitation(value: unknown): value is {
  source_id: string;
  title: string;
  url: string;
} {
  return isRecord(value) &&
    isNonEmptyString(value.source_id) &&
    typeof value.title === "string" &&
    typeof value.url === "string";
}

export function projectPublicPsychiatristCitationHref(
  value: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    isUnsafePsychiatristCitationHost(url.hostname)
  ) {
    return undefined;
  }
  return url.href;
}

function isUnsafePsychiatristCitationHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  try {
    return ipaddr.process(host.replace(/^\[/, "").replace(/\]$/, "")).range() !==
      "unicast";
  } catch {
    return false;
  }
}

export function isPsychiatristWarning(value: unknown): value is {
  code: string;
  message?: string;
} {
  return isRecord(value) &&
    isNonEmptyString(value.code) &&
    (value.message === undefined || typeof value.message === "string");
}
