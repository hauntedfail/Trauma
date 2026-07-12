import { describe, expect, it } from "vitest";

import {
  isPsychiatristRuntimeIsolationReady,
  PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION,
  PSYCHIATRIST_RUNTIME_ISOLATION_ENV,
} from "../../../src/server/psychiatrist/runtime-isolation";

describe("Psychiatrist runtime isolation", () => {
  it.each([undefined, "", "true", "externally_enforced"])(
    "rejects an absent or unsupported production assertion (%s)",
    (assertion) => {
      expect(
        isPsychiatristRuntimeIsolationReady({
          environment: { [PSYCHIATRIST_RUNTIME_ISOLATION_ENV]: assertion },
          hasInjectedClient: false,
        }),
      ).toBe(false);
    },
  );

  it("accepts only the documented external-isolation assertion", () => {
    expect(
      isPsychiatristRuntimeIsolationReady({
        environment: {
          [PSYCHIATRIST_RUNTIME_ISOLATION_ENV]:
            PSYCHIATRIST_RUNTIME_ISOLATION_ASSERTION,
        },
        hasInjectedClient: false,
      }),
    ).toBe(true);
  });

  it("keeps dependency-injected clients testable without an operator assertion", () => {
    expect(
      isPsychiatristRuntimeIsolationReady({
        environment: {},
        hasInjectedClient: true,
      }),
    ).toBe(true);
  });
});
