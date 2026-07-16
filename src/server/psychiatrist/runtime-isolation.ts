import {
  CODEX_RUNTIME_ISOLATION_ASSERTION,
  LEGACY_CODEX_RUNTIME_ISOLATION_ENV,
  isCodexRuntimeIsolationReady,
} from "../codex/runtime-isolation";

export const PSYCHIATRIST_RUNTIME_ISOLATION_ENV =
  LEGACY_CODEX_RUNTIME_ISOLATION_ENV;

export const PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION =
  CODEX_RUNTIME_ISOLATION_ASSERTION;

export const PSYCHIATRIST_RUNTIME_ISOLATION_ERROR = {
  code: "runtime_isolation_required",
  message: "Psychiatrist requires an externally isolated Codex runtime.",
} as const;

export function isPsychiatristRuntimeIsolationReady(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  hasInjectedClient: boolean;
}): boolean {
  return isCodexRuntimeIsolationReady(input);
}
