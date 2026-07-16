import { describe, expect, it } from "vitest";

import {
  CODEX_RUNTIME_ISOLATION_ASSERTION,
  CODEX_RUNTIME_ISOLATION_ENV,
  LEGACY_CODEX_RUNTIME_ISOLATION_ENV,
  isCodexRuntimeIsolationReady,
} from "../../../src/server/codex/runtime-isolation";

describe("Codex runtime isolation", () => {
  it("rejects production clients without the exact operator assertion", () => {
    for (const assertion of [undefined, "", "true", "externally_enforced"]) {
      expect(
        isCodexRuntimeIsolationReady({
          environment: { [CODEX_RUNTIME_ISOLATION_ENV]: assertion },
          hasInjectedClient: false,
        }),
      ).toBe(false);
    }
  });

  it("accepts the shared assertion and the legacy Psychiatrist name", () => {
    expect(
      isCodexRuntimeIsolationReady({
        environment: {
          [CODEX_RUNTIME_ISOLATION_ENV]: CODEX_RUNTIME_ISOLATION_ASSERTION,
        },
        hasInjectedClient: false,
      }),
    ).toBe(true);
    expect(
      isCodexRuntimeIsolationReady({
        environment: {
          [LEGACY_CODEX_RUNTIME_ISOLATION_ENV]:
            CODEX_RUNTIME_ISOLATION_ASSERTION,
        },
        hasInjectedClient: false,
      }),
    ).toBe(true);
  });

  it("keeps dependency-injected clients testable", () => {
    expect(
      isCodexRuntimeIsolationReady({ environment: {}, hasInjectedClient: true }),
    ).toBe(true);
  });
});
