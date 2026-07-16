const DEFAULT_TRUSTED_HOSTNAMES = ["127.0.0.1", "::1", "localhost"] as const;

export function readTrustedHostnames(
  configuredHosts: string | undefined,
): ReadonlySet<string> {
  const trustedHosts = new Set<string>(DEFAULT_TRUSTED_HOSTNAMES);
  if (configuredHosts === undefined || configuredHosts.trim() === "") {
    return trustedHosts;
  }

  for (const entry of configuredHosts.split(",")) {
    const hostname = normalizeConfiguredHostname(entry);
    if (hostname === undefined) {
      throw new Error(
        `Invalid TRAUMA_ALLOWED_HOSTS entry: ${JSON.stringify(entry.trim())}`,
      );
    }
    trustedHosts.add(hostname);
  }

  return trustedHosts;
}

export function isTrustedRequestHost(
  hostHeader: string | null,
  trustedHosts: ReadonlySet<string>,
): boolean {
  const hostname = parseHostAuthority(hostHeader, true);
  return hostname !== undefined && trustedHosts.has(hostname);
}

function normalizeConfiguredHostname(entry: string): string | undefined {
  const value = entry.trim();
  if (value === "" || value.includes("*")) {
    return undefined;
  }

  if (value === "::1") {
    return value;
  }

  return parseHostAuthority(value, false);
}

function parseHostAuthority(
  authority: string | null,
  allowPort: boolean,
): string | undefined {
  if (
    authority === null ||
    authority === "" ||
    authority !== authority.trim() ||
    /[,/\\@?#\s]/u.test(authority)
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(`http://${authority}`);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !allowPort && parsed.port !== ""
    ) {
      return undefined;
    }

    return parsed.hostname
      .replace(/^\[|\]$/gu, "")
      .replace(/\.$/u, "")
      .toLowerCase();
  } catch {
    return undefined;
  }
}
