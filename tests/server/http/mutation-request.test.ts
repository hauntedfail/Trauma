import { describe, expect, it } from "vitest";

import {
  guardMutationRequest,
  readJsonMutationRequest,
} from "../../../src/server/http/mutation-request";

describe("mutation request boundary", () => {
  it.each([
    {
      name: "matching browser origin",
      headers: { origin: "https://trauma.example" },
      expected: { ok: true, browser: true },
    },
    {
      name: "same-origin fetch metadata",
      headers: { "sec-fetch-site": "same-origin" },
      expected: { ok: true, browser: true },
    },
    {
      name: "non-browser client without browser headers",
      headers: {},
      expected: { ok: true, browser: false },
    },
    {
      name: "mismatched browser origin",
      headers: { origin: "https://evil.example" },
      expected: {
        ok: false,
        error: "same-origin request is required",
        status: 403,
      },
    },
    {
      name: "cross-site fetch metadata without Origin",
      headers: { "sec-fetch-site": "cross-site" },
      expected: {
        ok: false,
        error: "same-origin request is required",
        status: 403,
      },
    },
    {
      name: "same-site is not same-origin",
      headers: { "sec-fetch-site": "same-site" },
      expected: {
        ok: false,
        error: "same-origin request is required",
        status: 403,
      },
    },
  ])("classifies $name", ({ headers, expected }) => {
    const request = new Request("https://trauma.example/api/memories", {
      method: "POST",
      headers: headers as HeadersInit,
    });

    expect(guardMutationRequest(request)).toEqual(expected);
  });

  it("preserves JSON-body compatibility for non-browser clients without browser headers", async () => {
    const result = await readJsonMutationRequest(
      new Request("https://trauma.example/api/memories", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );

    expect(result).toEqual({
      ok: true,
      payload: { url: "https://example.com" },
    });
  });

  it("requires application/json for a body-bearing browser mutation", async () => {
    const result = await readJsonMutationRequest(
      new Request("https://trauma.example/api/memories", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          origin: "https://trauma.example",
        },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: "content-type must be application/json",
      status: 415,
    });
  });

  it("rejects a declared body length before reading the stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const result = await readJsonMutationRequest(
      streamRequest(body, {
        "content-length": "9",
        "content-type": "application/json",
        origin: "https://trauma.example",
      }),
      { maxBytes: 8 },
    );

    expect(result).toEqual({
      ok: false,
      error: "request body is too large",
      status: 413,
    });
  });

  it("bounds an undeclared streaming body and cancels it on overflow", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("too large"));
      },
      cancel() {
        canceled = true;
      },
    });
    const result = await readJsonMutationRequest(
      streamRequest(body, {
        "content-type": "application/json",
        origin: "https://trauma.example",
      }),
      { maxBytes: 12 },
    );

    expect(result).toEqual({
      ok: false,
      error: "request body is too large",
      status: 413,
    });
    expect(canceled).toBe(true);
  });

  it("guards an intentionally empty mutation without requiring a content type", async () => {
    const sameOrigin = await readJsonMutationRequest(
      new Request("https://trauma.example/api/translation", {
        method: "POST",
        headers: { origin: "https://trauma.example" },
      }),
      { allowEmpty: true },
    );
    const crossOrigin = await readJsonMutationRequest(
      new Request("https://trauma.example/api/translation", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      { allowEmpty: true },
    );

    expect(sameOrigin).toEqual({ ok: true, payload: undefined });
    expect(crossOrigin).toEqual({
      ok: false,
      error: "same-origin request is required",
      status: 403,
    });
  });
});

function streamRequest(
  body: ReadableStream<Uint8Array>,
  headers: HeadersInit,
): Request {
  return new Request("https://trauma.example/api/memories", {
    method: "POST",
    headers,
    body,
    // Node's Request implementation requires this for a streaming body. Bun
    // accepts the option and ignores it when it is unnecessary.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
