import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  MemoryReadStatusControl,
  submitMemoryReadStatus,
} from "../../src/components/memories/MemoryReadStatusControl";

describe("memory read status control", () => {
  it("renders read state and inverse action text", () => {
    const readHtml = renderToString(() =>
      createComponent(MemoryReadStatusControl, {
        memoryId: "memory-1",
        initialRead: true,
      }),
    );
    const unreadHtml = renderToString(() =>
      createComponent(MemoryReadStatusControl, {
        memoryId: "memory-1",
        initialRead: false,
      }),
    );

    expect(readHtml).toContain("Read");
    expect(readHtml).toContain("Mark unread");
    expect(readHtml).toContain('aria-pressed="true"');
    expect(unreadHtml).toContain("Unread");
    expect(unreadHtml).toContain("Mark read");
    expect(unreadHtml).toContain('aria-pressed="false"');
  });

  it("posts read status changes to the API", async () => {
    const requests: Request[] = [];
    const result = await submitMemoryReadStatus({
      memoryId: "memory-1",
      read: true,
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(JSON.stringify({ memoryId: "memory-1", read: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(result).toEqual({ memoryId: "memory-1", read: true });
    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost/api/memories/read-status",
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      read: true,
    });
  });

  it("returns a stable failure when the API rejects the update", async () => {
    await expect(
      submitMemoryReadStatus({
        memoryId: "memory-1",
        read: true,
        fetch: async () =>
          new Response(JSON.stringify({ error: "memory was not found" }), {
            status: 404,
          }),
      }),
    ).rejects.toThrow("failed to update read status");
  });
});
