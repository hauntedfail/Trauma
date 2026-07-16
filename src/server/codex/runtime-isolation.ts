export const CODEX_RUNTIME_ISOLATION_ENV = "TRAUMA_CODEX_RUNTIME_ISOLATION";
export const LEGACY_CODEX_RUNTIME_ISOLATION_ENV =
  "TRAUMA_PSYCHIATRIST_RUNTIME_ISOLATION";
export const CODEX_RUNTIME_ISOLATION_ASSERTION =
  "external_no_host_reads_public_http_https_only";

export const CODEX_RUNTIME_ISOLATION_ERROR = {
  code: "runtime_isolation_required",
  message: "Codex features require an externally isolated runtime.",
} as const;

// This gate records operator intent; it cannot create or verify isolation.
export function isCodexRuntimeIsolationReady(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  hasInjectedClient: boolean;
}): boolean {
  if (input.hasInjectedClient) {
    return true;
  }
  const environment = input.environment ?? process.env;
  return [
    environment[CODEX_RUNTIME_ISOLATION_ENV],
    environment[LEGACY_CODEX_RUNTIME_ISOLATION_ENV],
  ].includes(CODEX_RUNTIME_ISOLATION_ASSERTION);
}
