export const DEV_SMOKE_RUNTIME_FIXTURE_CONTEXT = "dev-smoke-v1";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The dev-smoke launcher is the only server startup that may omit persistent
 * runtime configuration. Browse fixtures alone are also used by E2E and are
 * never sufficient to bypass the single-instance lease.
 */
export function isRuntimeLeaseFixtureBypassAllowed(
  environment: RuntimeEnvironment,
  request: Request,
): boolean {
  const url = new URL(request.url);
  return (
    environment.TRAUMA_BROWSE_FIXTURES === "1" &&
    environment.TRAUMA_RUNTIME_FIXTURE_CONTEXT ===
      DEV_SMOKE_RUNTIME_FIXTURE_CONTEXT &&
    isBlank(environment.TRAUMA_CONFIG_PATH) &&
    isBlank(environment.TRAUMA_DATABASE_PATH) &&
    environment.NODE_ENV !== "production" &&
    isLoopbackHost(environment.HOST) &&
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname === "/" &&
    url.search === ""
  );
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function isLoopbackHost(value: string | undefined): boolean {
  const host = value?.trim().toLocaleLowerCase("en-US");
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
