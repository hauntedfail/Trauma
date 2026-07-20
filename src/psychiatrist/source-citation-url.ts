import ipaddr from "ipaddr.js";

const MAX_URL_CHARS = 2048;
const NON_PUBLIC_DNS_SUFFIXES = [
  "alt",
  "corp",
  "example",
  "home",
  "home.arpa",
  "internal",
  "invalid",
  "lan",
  "local",
  "localdomain",
  "localhost",
  "onion",
  "test",
] as const;

export function projectPublicPsychiatristCitationUrl(
  value: string,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    isNonPublicCitationHost(url.hostname)
  ) {
    return undefined;
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const projected = url.toString();
  return projected.length > MAX_URL_CHARS ? undefined : projected;
}

function isNonPublicCitationHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.+$/, "");
  if (host === "") {
    return true;
  }
  const address = parseIpAddress(host);
  if (address !== undefined) {
    return address.range() !== "unicast";
  }
  if (!host.includes(".")) {
    return true;
  }
  return NON_PUBLIC_DNS_SUFFIXES.some((suffix) =>
    host === suffix || host.endsWith(`.${suffix}`)
  );
}

function parseIpAddress(host: string): ReturnType<typeof ipaddr.process> | undefined {
  try {
    return ipaddr.process(host);
  } catch {
    return undefined;
  }
}
