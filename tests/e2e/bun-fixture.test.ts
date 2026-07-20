import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inspectE2eFixtureValues,
  resetE2eFixture,
} from "../../e2e/bun-fixture";
import { E2E_CONTROL_TOKEN_HEADER } from "../../src/server/e2e/control-types";

const originalToken = process.env.TRAUMA_E2E_CONTROL_TOKEN;
const token = ["e2e", "fixture", "control", "token", "for", "tests", "only"].join("-");

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) {
    delete process.env.TRAUMA_E2E_CONTROL_TOKEN;
  } else {
    process.env.TRAUMA_E2E_CONTROL_TOKEN = originalToken;
  }
});

describe("typed in-server E2E fixture client", () => {
  it("sends a closed action and per-run token to the loopback control route", async () => {
    process.env.TRAUMA_E2E_CONTROL_TOKEN = token;
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await resetE2eFixture("read_only");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:4173/api/e2e-control");
    expect(init).toMatchObject({ method: "POST" });
    expect(new Headers(init?.headers).get(E2E_CONTROL_TOKEN_HEADER)).toBe(token);
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "reset_fixture",
      fixture: "read_only",
    });
  });

  it("fails closed on a malformed inspection response", async () => {
    process.env.TRAUMA_E2E_CONTROL_TOKEN = token;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ok: true, values: ["valid", 1] }),
      { status: 200 },
    )));

    await expect(inspectE2eFixtureValues("moment_anchors")).rejects.toThrow(
      "invalid list response",
    );
  });

  it.each(["short", "x".repeat(257)])(
    "does not issue a request with an invalid per-run token",
    async (invalidToken) => {
      process.env.TRAUMA_E2E_CONTROL_TOKEN = invalidToken;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(resetE2eFixture("backup_git")).rejects.toThrow(
        "control token is unavailable",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
