import { afterEach, describe, expect, it } from "vitest";

import {
  authenticateApiRequest,
  extractBearerToken,
  readConfiguredApiToken,
  TRAUMA_API_TOKEN_ENV_VAR,
  verifyApiToken,
} from "../../../src/server/http/api-auth";
import {
  guardMutationRequest,
  readJsonMutationRequest,
} from "../../../src/server/http/mutation-request";

const originalApiToken = process.env[TRAUMA_API_TOKEN_ENV_VAR];

afterEach(() => {
  if (originalApiToken === undefined) {
    delete process.env[TRAUMA_API_TOKEN_ENV_VAR];
  } else {
    process.env[TRAUMA_API_TOKEN_ENV_VAR] = originalApiToken;
  }
});

describe("API bearer token authentication", () => {
  it("reads TRAUMA_API_TOKEN and treats empty or whitespace values as unset", () => {
    expect(readConfiguredApiToken({})).toBeUndefined();
    expect(readConfiguredApiToken({ TRAUMA_API_TOKEN: "" })).toBeUndefined();
    expect(readConfiguredApiToken({ TRAUMA_API_TOKEN: "   " })).toBeUndefined();
    expect(readConfiguredApiToken({ TRAUMA_API_TOKEN: "  secret-token  " })).toBe(
      "secret-token",
    );
  });

  it("extracts bearer tokens case-insensitively and ignores non-bearer headers", () => {
    expect(
      extractBearerToken(new Request("http://localhost/api/memories")),
    ).toEqual({ present: false });
    expect(
      extractBearerToken(
        new Request("http://localhost/api/memories", {
          headers: { authorization: "Basic dXNlcjpwYXNz" },
        }),
      ),
    ).toEqual({ present: false });
    expect(
      extractBearerToken(
        new Request("http://localhost/api/memories", {
          headers: { authorization: "Bearer my-token-123" },
        }),
      ),
    ).toEqual({ present: true, token: "my-token-123" });
    expect(
      extractBearerToken(
        new Request("http://localhost/api/memories", {
          headers: { authorization: "bearer   spaced-token  " },
        }),
      ),
    ).toEqual({ present: true, token: "spaced-token" });
    expect(
      extractBearerToken(
        new Request("http://localhost/api/memories", {
          headers: { authorization: "Bearer" },
        }),
      ),
    ).toEqual({ present: true, token: "" });
  });

  it("verifies tokens in constant time including mismatched lengths", () => {
    expect(verifyApiToken("super-secret-token", "super-secret-token")).toBe(true);
    expect(verifyApiToken("short", "super-secret-token")).toBe(false);
    expect(verifyApiToken("super-secret-token-extra", "super-secret-token")).toBe(
      false,
    );
    expect(verifyApiToken("", "super-secret-token")).toBe(false);
    expect(verifyApiToken("super-secret-token", "")).toBe(false);
  });

  it("allows unauthenticated requests when TRAUMA_API_TOKEN is unset or no Bearer header is sent", () => {
    const requestWithBearer = new Request("http://localhost/api/memories", {
      headers: { authorization: "Bearer any-token" },
    });
    expect(authenticateApiRequest(requestWithBearer, {})).toEqual({
      ok: true,
      authenticated: false,
    });

    const requestWithoutBearer = new Request("http://localhost/api/memories");
    expect(
      authenticateApiRequest(requestWithoutBearer, {
        TRAUMA_API_TOKEN: "configured-secret",
      }),
    ).toEqual({
      ok: true,
      authenticated: false,
    });
  });

  it("returns 401 when TRAUMA_API_TOKEN is set and an invalid Bearer token is presented", () => {
    const invalidRequest = new Request("http://localhost/api/memories", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(
      authenticateApiRequest(invalidRequest, {
        TRAUMA_API_TOKEN: "configured-secret",
      }),
    ).toEqual({
      ok: false,
      error: "invalid API token",
      status: 401,
    });

    const emptyBearerRequest = new Request("http://localhost/api/memories", {
      headers: { authorization: "Bearer   " },
    });
    expect(
      authenticateApiRequest(emptyBearerRequest, {
        TRAUMA_API_TOKEN: "configured-secret",
      }),
    ).toEqual({
      ok: false,
      error: "invalid API token",
      status: 401,
    });
  });

  it("integrates with guardMutationRequest and preserves browser CSRF checks", async () => {
    process.env[TRAUMA_API_TOKEN_ENV_VAR] = "hermes-secret-token";

    // Valid bearer token allows headless mutation without Origin/Sec-Fetch-Site
    const validBearerRequest = new Request("https://trauma.example/api/memories", {
      method: "POST",
      headers: {
        authorization: "Bearer hermes-secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(guardMutationRequest(validBearerRequest)).toEqual({
      ok: true,
      browser: false,
    });
    await expect(readJsonMutationRequest(validBearerRequest)).resolves.toEqual({
      ok: true,
      payload: { url: "https://example.com" },
    });

    // Invalid bearer token returns 401
    const invalidBearerRequest = new Request("https://trauma.example/api/memories", {
      method: "DELETE",
      headers: {
        authorization: "Bearer wrong-token",
      },
    });
    expect(guardMutationRequest(invalidBearerRequest)).toEqual({
      ok: false,
      error: "invalid API token",
      status: 401,
    });

    // No bearer token preserves browser CSRF guard
    const crossOriginBrowserRequest = new Request(
      "https://trauma.example/api/memories",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "https://example.com" }),
      },
    );
    expect(guardMutationRequest(crossOriginBrowserRequest)).toEqual({
      ok: false,
      error: "same-origin request is required",
      status: 403,
    });

    const sameOriginBrowserRequest = new Request(
      "https://trauma.example/api/memories",
      {
        method: "POST",
        headers: {
          origin: "https://trauma.example",
        },
      },
    );
    expect(guardMutationRequest(sameOriginBrowserRequest)).toEqual({
      ok: true,
      browser: true,
    });
  });
});
