import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  MemoryReadStatusControl,
  submitMemoryReadStatus,
} from "../../src/components/memories/MemoryReadStatusControl";

const source = readFileSync(
  "src/components/memories/MemoryReadStatusControl.tsx",
  "utf8",
);

describe("memory read status control", () => {
  it("renders read state and inverse action text in label mode", () => {
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
    expect(readHtml).toContain('data-read-status-icon="read"');
    expect(readHtml).toContain('d="m5 12 4 4L19 6"');
    expect(unreadHtml).toContain("Unread");
    expect(unreadHtml).toContain("Mark read");
    expect(unreadHtml).toContain('aria-pressed="false"');
    expect(unreadHtml).toContain('data-read-status-icon="unread"');
    expect(unreadHtml).not.toContain('d="m5 12 4 4L19 6"');
  });

  it("renders icon-only action mode with accessible names", () => {
    const readHtml = renderToString(() =>
      createComponent(MemoryReadStatusControl, {
        memoryId: "memory-1",
        initialRead: true,
        variant: "icon",
      }),
    );
    const unreadHtml = renderToString(() =>
      createComponent(MemoryReadStatusControl, {
        memoryId: "memory-1",
        initialRead: false,
        variant: "icon",
      }),
    );

    expect(readHtml).toContain('aria-label="Mark memory unread"');
    expect(readHtml).toContain('data-read-status-icon="read"');
    expect(readHtml).toContain("M3 5l18 14");
    expect(readHtml).not.toContain(">Read<");
    expect(readHtml).not.toContain("Mark unread");
    expect(unreadHtml).toContain('aria-label="Mark memory read"');
    expect(unreadHtml).toContain('data-read-status-icon="unread"');
    expect(unreadHtml).toContain("M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z");
    expect(unreadHtml).not.toContain(">Unread<");
    expect(unreadHtml).not.toContain("Mark read");
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

  it("guards in-flight responses when the control is reused for another memory", () => {
    expect(source).toContain("requestVersion += 1");
    expect(source).toContain("isCurrentReadStatusRequest");
    expect(source).toContain("props.memoryId === input.memoryId");
  });
});
