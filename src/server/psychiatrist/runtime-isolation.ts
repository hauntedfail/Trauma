export const PSYCHIATRIST_RUNTIME_ISOLATION_ENV =
  "TRAUMA_PSYCHIATRIST_RUNTIME_ISOLATION";

export const PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION =
  "external_no_host_reads_public_http_https_only";

export const PSYCHIATRIST_RUNTIME_ISOLATION_ERROR = {
  code: "runtime_isolation_required",
  message: "Psychiatrist requires an externally isolated Codex runtime.",
} as const;

// This gate records operator intent; it cannot create or verify external isolation.
export function isPsychiatristRuntimeIsolationReady(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  hasInjectedClient: boolean;
}): boolean {
  if (input.hasInjectedClient) {
    return true;
  }
  const environment = input.environment ?? process.env;
  return environment[PSYCHIATRIST_RUNTIME_ISOLATION_ENV] ===
    PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION;
}
