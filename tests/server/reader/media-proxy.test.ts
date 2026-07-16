import { describe, expect, it } from "vitest";

import type {
  HostResolver,
  PinnedAddressFetch,
} from "../../../src/server/importer";
import {
  handleReaderMediaRequest,
} from "../../../src/server/reader/media-proxy";

const publicAddress = "93.184.216.34";

describe("reader media proxy", () => {
  it("fetches a raster image through a pinned public address without cookies", async () => {
    const fetchAddress: PinnedAddressFetch = async (url, address, init) => {
      expect(url.toString()).toBe("https://cdn.example.test/image.png");
      expect(address).toBe(publicAddress);
      expect(init?.redirect).toBe("manual");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).get("cookie")).toBeNull();
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      expect(new Headers(init?.headers).get("accept")).toContain("image/png");
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-type": "image/png; charset=binary",
          "set-cookie": "upstream=must-not-leak",
        },
      });
    };

    const response = await handleReaderMediaRequest(
      createRequest("https://cdn.example.test/image.png", {
        headers: {
          authorization: "Bearer must-not-forward",
          cookie: "session=must-not-forward",
        },
      }),
      {
        fetchAddress,
        resolveHostname: publicResolver,
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=300, no-transform",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("rejects non-HTTPS, credential-bearing, and IP-literal targets", async () => {
    let fetchCalls = 0;
    const fetchAddress: PinnedAddressFetch = async () => {
      fetchCalls += 1;
      return imageResponse();
    };

    for (const target of [
      "http://cdn.example.test/image.png",
      "https://user:secret@cdn.example.test/image.png",
      "https://93.184.216.34/image.png",
      "https://[2001:4860:4860::8888]/image.png",
    ]) {
      const response = await handleReaderMediaRequest(createRequest(target), {
        fetchAddress,
        resolveHostname: publicResolver,
      });
      expect(response.status, target).toBe(400);
    }

    expect(fetchCalls).toBe(0);
  });

  it("rejects a hostname when any pinned DNS answer is private", async () => {
    let fetchCalls = 0;
    const response = await handleReaderMediaRequest(
      createRequest("https://private.example.test/image.png"),
      {
        fetchAddress: async () => {
          fetchCalls += 1;
          return imageResponse();
        },
        resolveHostname: async () => [publicAddress, "127.0.0.1"],
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "reader media URL must target a public HTTPS hostname",
    });
    expect(fetchCalls).toBe(0);
  });

  it("pins and validates every redirect hop", async () => {
    const requested: Array<{ address: string; url: string }> = [];
    let redirectBodyCanceled = false;
    const response = await handleReaderMediaRequest(
      createRequest("https://origin.example.test/image.png"),
      {
        fetchAddress: async (url, address) => {
          requested.push({ address, url: url.toString() });
          if (requested.length === 1) {
            return new Response(
              new ReadableStream<Uint8Array>({
                cancel() {
                  redirectBodyCanceled = true;
                },
              }),
              {
                status: 302,
                headers: {
                  location: "https://cdn.example.test/final.webp",
                },
              },
            );
          }
          return imageResponse("image/webp", [4, 5]);
        },
        resolveHostname: publicResolver,
      },
    );

    expect(response.status).toBe(200);
    expect(requested).toEqual([
      {
        address: publicAddress,
        url: "https://origin.example.test/image.png",
      },
      {
        address: publicAddress,
        url: "https://cdn.example.test/final.webp",
      },
    ]);
    expect(redirectBodyCanceled).toBe(true);
  });

  it("rejects an unsafe redirect target before following it", async () => {
    let fetchCalls = 0;
    const response = await handleReaderMediaRequest(
      createRequest("https://origin.example.test/image.png"),
      {
        fetchAddress: async () => {
          fetchCalls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/private.png" },
          });
        },
        resolveHostname: publicResolver,
      },
    );

    expect(response.status).toBe(400);
    expect(fetchCalls).toBe(1);
  });

  it("rejects a declared image body larger than the byte cap", async () => {
    let canceled = false;
    const response = await handleReaderMediaRequest(
      createRequest("https://cdn.example.test/large.png"),
      {
        fetchAddress: async () => new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              canceled = true;
            },
          }),
          {
            headers: {
              "content-length": "11",
              "content-type": "image/png",
            },
          },
        ),
        maxBytes: 10,
        resolveHostname: publicResolver,
      },
    );

    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
  });

  it("cancels a chunked image body as soon as the streaming cap is exceeded", async () => {
    let pulls = 0;
    let canceled = false;
    const response = await handleReaderMediaRequest(
      createRequest("https://cdn.example.test/chunked.png"),
      {
        fetchAddress: async () => new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                pulls += 1;
                controller.enqueue(new Uint8Array(6));
              },
              cancel() {
                canceled = true;
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { "content-type": "image/png" } },
        ),
        maxBytes: 10,
        resolveHostname: publicResolver,
      },
    );

    expect(response.status).toBe(413);
    expect(pulls).toBe(2);
    expect(canceled).toBe(true);
  });

  it("rejects SVG, non-image, and missing content types", async () => {
    for (const contentType of ["image/svg+xml", "text/html", null]) {
      const response = await handleReaderMediaRequest(
        createRequest("https://cdn.example.test/untrusted"),
        {
          fetchAddress: async () => new Response("untrusted", {
            headers: contentType === null ? {} : { "content-type": contentType },
          }),
          resolveHostname: publicResolver,
        },
      );

      expect(response.status, contentType ?? "missing").toBe(415);
    }
  });

  it("aborts a pinned fetch when the proxy timeout expires", async () => {
    let observedAbort = false;
    const response = await handleReaderMediaRequest(
      createRequest("https://cdn.example.test/slow.png"),
      {
        fetchAddress: async (_url, _address, init) => new Promise(
          (_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => {
              observedAbort = true;
              reject(new Error("aborted"));
            }, { once: true });
          },
        ),
        resolveHostname: publicResolver,
        timeoutMs: 1,
      },
    );

    expect(response.status).toBe(504);
    expect(observedAbort).toBe(true);
  });

  it("does not start a pinned fetch for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetchCalls = 0;

    const response = await handleReaderMediaRequest(
      createRequest("https://cdn.example.test/image.png", {
        signal: controller.signal,
      }),
      {
        fetchAddress: async () => {
          fetchCalls += 1;
          return imageResponse();
        },
        resolveHostname: publicResolver,
      },
    );

    expect(response.status).toBe(499);
    expect(fetchCalls).toBe(0);
  });
});

const publicResolver: HostResolver = async () => [publicAddress];

function createRequest(target: string, init?: RequestInit): Request {
  return new Request(
    `http://localhost/api/reader-media?url=${encodeURIComponent(target)}`,
    init,
  );
}

function imageResponse(
  contentType = "image/png",
  bytes = [1],
): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": contentType },
  });
}
