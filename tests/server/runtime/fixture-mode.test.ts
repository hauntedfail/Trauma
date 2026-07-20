import { describe, expect, it } from "vitest";

import {
  DEV_SMOKE_RUNTIME_FIXTURE_CONTEXT,
  isRuntimeLeaseFixtureBypassAllowed,
} from "../../../src/server/runtime/fixture-mode";

const allowedEnvironment = {
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  TRAUMA_BROWSE_FIXTURES: "1",
  TRAUMA_CONFIG_PATH: "",
  TRAUMA_DATABASE_PATH: "",
  TRAUMA_RUNTIME_FIXTURE_CONTEXT: DEV_SMOKE_RUNTIME_FIXTURE_CONTEXT,
};

describe("runtime lease fixture bypass", () => {
  it.each(["GET", "HEAD"])("allows only the exact %s root smoke probe", (method) => {
    expect(
      isRuntimeLeaseFixtureBypassAllowed(
        allowedEnvironment,
        new Request("http://127.0.0.1/", { method }),
      ),
    ).toBe(true);
  });

  it.each([
    ["query string", {}, "GET", "/?ready=1"],
    ["other path", {}, "GET", "/memories"],
    ["mutating method", {}, "POST", "/"],
    ["wrong context", { TRAUMA_RUNTIME_FIXTURE_CONTEXT: "e2e" }, "GET", "/"],
    ["missing browse fixture", { TRAUMA_BROWSE_FIXTURES: undefined }, "GET", "/"],
    ["configured runtime", { TRAUMA_CONFIG_PATH: "trauma.config.json" }, "GET", "/"],
    ["configured database", { TRAUMA_DATABASE_PATH: "trauma.sqlite" }, "GET", "/"],
    ["production", { NODE_ENV: "production" }, "GET", "/"],
    ["non-loopback host", { HOST: "0.0.0.0" }, "GET", "/"],
  ] as const)("rejects %s", (_name, environment, method, path) => {
    expect(
      isRuntimeLeaseFixtureBypassAllowed(
        { ...allowedEnvironment, ...environment },
        new Request(`http://127.0.0.1${path}`, { method }),
      ),
    ).toBe(false);
  });
});
