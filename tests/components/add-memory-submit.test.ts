import { describe, expect, it } from "vitest";

import { submitAddMemoryUrl } from "../../src/components/memories/add-memory-submit";

describe("add memory submission", () => {
  it("posts the trimmed URL and returns the created memory id", async () => {
    const requests: Request[] = [];

    const result = await submitAddMemoryUrl({
      url: " https://example.com/article ",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));

        return new Response(
          JSON.stringify({ memory: { id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef111" } }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(result).toEqual({
      ok: true,
      memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef111",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost/api/memories");
    expect(requests[0]?.method).toBe("POST");
    expect(Object.fromEntries(requests[0]?.headers.entries() ?? [])).toMatchObject({
      "content-type": "application/json",
    });
    expect(await requests[0]?.json()).toEqual({
      url: "https://example.com/article",
    });
  });

  it("does not submit an empty URL", async () => {
    let called = false;

    const result = await submitAddMemoryUrl({
      url: "   ",
      fetch: async () => {
        called = true;
        return new Response("{}");
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Enter a URL before saving.",
    });
    expect(called).toBe(false);
  });

  it("returns the API error message for rejected submissions", async () => {
    const result = await submitAddMemoryUrl({
      url: "ftp://example.com/file",
      fetch: async () =>
        new Response(JSON.stringify({ error: "url must be a valid absolute URL" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(result).toEqual({
      ok: false,
      error: "url must be a valid absolute URL",
    });
  });
});
