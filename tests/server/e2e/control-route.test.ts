import type { APIEvent } from "@solidjs/start/server";
import { describe, expect, it, vi } from "vitest";

import {
  createE2eControlPostHandler,
} from "../../../src/server/e2e/control-route";
import {
  E2E_CONTROL_MAX_BODY_BYTES,
  E2E_CONTROL_TOKEN_HEADER,
  type E2eControlRequest,
  type E2eControlResult,
} from "../../../src/server/e2e/control-types";

const validToken = "0123456789abcdef0123456789abcdef";
const validEnv = {
  HOST: "127.0.0.1",
  TRAUMA_BROWSE_FIXTURES: "1",
  TRAUMA_CONFIG_PATH: ".trauma/e2e/trauma.config.json",
  TRAUMA_E2E_CONTROL: "1",
  TRAUMA_E2E_CONTROL_TOKEN: validToken,
  TRAUMA_E2E_IMPORT_FIXTURES: "1",
};

describe("E2E fixture control route", () => {
  it("dispatches the four closed action families after all guards pass", async () => {
    const execute = vi.fn(async (
      request: E2eControlRequest,
    ): Promise<E2eControlResult> => {
      if (request.action === "inspect_fixture_state") {
        return request.inspection === "persistence_state"
          ? { state: persistenceState(request.memoryId) }
          : { values: ["fixture-value"] };
      }
      return {};
    });
    const handler = createE2eControlPostHandler({ env: validEnv, execute });
    const requests: readonly E2eControlRequest[] = [
      { action: "reset_fixture", fixture: "read_only" },
      { action: "materialize_fixture", fixture: "reader_base" },
      {
        action: "mutate_fixture_state",
        mutation: "moment_delete_focus_rows",
      },
      { action: "inspect_fixture_state", inspection: "moment_anchors" },
      {
        action: "inspect_fixture_state",
        inspection: "persistence_state",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
      },
    ];

    for (const request of requests) {
      const response = await handler(eventFor(request));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    expect(execute.mock.calls.map(([request]) => request)).toEqual(requests);
  });

  it.each([
    ["no E2E environment", {}],
    ["missing explicit control signal", { ...validEnv, TRAUMA_E2E_CONTROL: undefined }],
    ["missing browse fixture signal", { ...validEnv, TRAUMA_BROWSE_FIXTURES: undefined }],
    ["missing import fixture signal", { ...validEnv, TRAUMA_E2E_IMPORT_FIXTURES: undefined }],
    ["different config path", { ...validEnv, TRAUMA_CONFIG_PATH: "trauma.config.json" }],
    ["short configured token", { ...validEnv, TRAUMA_E2E_CONTROL_TOKEN: "x".repeat(31) }],
    ["oversized configured token", { ...validEnv, TRAUMA_E2E_CONTROL_TOKEN: "x".repeat(257) }],
  ])("returns 404 for %s", async (_label, env) => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env, execute });

    const response = await handler(eventFor({
      action: "reset_fixture",
      fixture: "read_only",
    }));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["missing bind host", undefined],
    ["all-interface IPv4 bind", "0.0.0.0"],
    ["all-interface IPv6 bind", "::"],
    ["non-loopback bind", "192.0.2.10"],
  ])("returns 404 for %s despite forged loopback request metadata", async (
    _label,
    host,
  ) => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({
      env: { ...validEnv, HOST: host },
      execute,
    });

    const response = await handler(eventFor({
      action: "reset_fixture",
      fixture: "read_only",
    }));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["missing client address", null],
    ["non-loopback client address", "203.0.113.10"],
  ])("returns 404 for a %s despite forged loopback request metadata", async (
    _label,
    clientAddress,
  ) => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });

    const response = await handler(eventFor(
      { action: "reset_fixture", fixture: "read_only" },
      { clientAddress },
    ));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["missing token", null],
    ["wrong token", `${validToken}x`],
  ])("returns 404 for a %s header", async (_label, token) => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });

    const response = await handler(eventFor(
      { action: "reset_fixture", fixture: "read_only" },
      { token },
    ));

    expect(response.status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["external URL", "http://attacker.example/api/e2e-control", "127.0.0.1:4173"],
    ["external Host", "http://127.0.0.1:4173/api/e2e-control", "attacker.example"],
  ])("returns 404 for an %s", async (_label, url, host) => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });
    const response = await handler(eventFor(
      { action: "reset_fixture", fixture: "read_only" },
      { host, url },
    ));

    expect(response.status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { action: "reset_fixture", fixture: "read_only", extra: true },
    { action: "reset_fixture", fixture: "unknown" },
    { action: "materialize_fixture", fixture: "read_only" },
    { action: "mutate_fixture_state", mutation: "run_sql" },
    { action: "inspect_fixture_state", inspection: "persistence_state" },
    {
      action: "inspect_fixture_state",
      inspection: "persistence_state",
      memoryId: "../../outside",
    },
    { action: "inspect_fixture_state", inspection: "moment_anchors", memoryId: "extra" },
  ])("rejects invalid or non-exact payload %#", async (payload) => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });

    const response = await handler(eventFor(payload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "request body has an invalid E2E fixture action",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects oversized input before execution", async () => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });
    const response = await handler(eventFor(
      { action: "reset_fixture", fixture: "read_only" },
      { contentLength: E2E_CONTROL_MAX_BODY_BYTES + 1 },
    ));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "request body is too large",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body without a content-length header", async () => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });
    const response = await handler(eventFor({
      action: "reset_fixture",
      fixture: "read_only",
      padding: "x".repeat(E2E_CONTROL_MAX_BODY_BYTES),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "request body is too large",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("applies the shared same-origin mutation guard after hidden-route authorization", async () => {
    const execute = vi.fn();
    const handler = createE2eControlPostHandler({ env: validEnv, execute });
    const response = await handler(eventFor(
      { action: "reset_fixture", fixture: "read_only" },
      { origin: "https://attacker.example", fetchSite: "cross-site" },
    ));

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});

function eventFor(
  payload: unknown,
  options: {
    clientAddress?: string | null;
    contentLength?: number;
    fetchSite?: string;
    host?: string;
    origin?: string;
    token?: string | null;
    url?: string;
  } = {},
): APIEvent {
  const headers = new Headers({
    "content-type": "application/json",
    host: options.host ?? "127.0.0.1:4173",
  });
  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }
  if (options.fetchSite !== undefined) {
    headers.set("sec-fetch-site", options.fetchSite);
  }
  if (options.origin !== undefined) {
    headers.set("origin", options.origin);
  }
  const token = options.token === undefined ? validToken : options.token;
  if (token !== null) {
    headers.set(E2E_CONTROL_TOKEN_HEADER, token);
  }

  return {
    request: new Request(
      options.url ?? "http://127.0.0.1:4173/api/e2e-control",
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      },
    ),
    params: {},
    response: new Response(),
    locals: {},
    nativeEvent: {},
    clientAddress: options.clientAddress === undefined
      ? "127.0.0.1"
      : options.clientAddress ?? undefined,
  } as unknown as APIEvent;
}

function persistenceState(memoryId: string) {
  return {
    backupStatus: null,
    commitCount: 0,
    commitMessage: null,
    contentPath: null,
    extractionError: null,
    extractionStatus: null,
    fileContent: null,
    gitStatus: null,
    id: memoryId,
    title: null,
    trackedContent: null,
    url: null,
  };
}
