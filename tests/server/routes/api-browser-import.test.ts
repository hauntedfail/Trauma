import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import { OPTIONS, POST } from "../../../src/routes/api/browser-import";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("browser import API route", () => {
  it("rejects requests when browser import is disabled", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "false";

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "browser import is disabled" });
  });

  it("rejects ordinary website origins before body processing", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = "token";

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      error: "browser import origin is not allowed",
    });
  });

  it("rejects invalid tokens and exposes CORS only to extension origins", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = "token";

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: "Bearer wrong",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://extension-id",
    );
    expect(await response.json()).toEqual({
      error: "browser import token is invalid",
    });
  });

  it("answers extension preflight requests", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = "token";

    const response = await OPTIONS(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "OPTIONS",
          headers: {
            origin: "chrome-extension://extension-id",
          },
        }),
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });

  it("rejects streamed request bodies as soon as the byte cap is exceeded", async () => {
    process.env.TRAUMA_BROWSER_IMPORT_ENABLED = "true";
    process.env.TRAUMA_BROWSER_IMPORT_TOKEN = "token";
    process.env.TRAUMA_BROWSER_IMPORT_MAX_BYTES = "100000";
    const encoder = new TextEncoder();
    let pulledChunks = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks += 1;
        if (pulledChunks > 3) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode("a".repeat(60_000)));
      },
      cancel() {
        canceled = true;
      },
    });

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/browser-import", {
          method: "POST",
          headers: {
            origin: "chrome-extension://extension-id",
            authorization: "Bearer token",
            "content-type": "application/json",
          },
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      ),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "request body is too large",
    });
    expect(pulledChunks).toBe(2);
    expect(canceled).toBe(true);
  });
});

function createApiEvent(request: Request): APIEvent {
  return {
    request,
    params: {},
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}
