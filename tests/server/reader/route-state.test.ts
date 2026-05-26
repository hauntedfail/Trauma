import { describe, expect, it } from "vitest";

import {
  readerHttpStatusCode,
  titleForReaderResult,
} from "../../../src/components/reader/route-state";

describe("reader route state", () => {
  it("maps loading and ready results to document titles", () => {
    expect(titleForReaderResult(undefined)).toBe("Memory | TRAUMA");
    expect(
      titleForReaderResult({
        status: "ready",
        memory: {
          id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001",
          url: "https://example.com",
          title: "Reader Title",
          description: null,
          faviconUrl: null,
          extractionStatus: "success",
          contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f001/CONTENT.md",
          read: false,
          categories: [],
          moments: [],
          tags: [],
          flashbacks: [],
          createdAt: new Date("2026-05-09T00:00:00.000Z"),
          updatedAt: new Date("2026-05-09T00:00:00.000Z"),
        },
        content: {
          relativePath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f001/CONTENT.md",
          variants: [],
        },
        rendered: {
          html: "<h1>Reader Title</h1>",
          toc: [],
        },
      }),
    ).toBe("Reader Title | TRAUMA");
  });

  it("maps reader error results to HTTP status codes", () => {
    expect(readerHttpStatusCode(undefined)).toBeUndefined();
    expect(
      readerHttpStatusCode({
        status: "ready",
        memory: {
          id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f001",
          url: "https://example.com",
          title: "Reader Title",
          description: null,
          faviconUrl: null,
          extractionStatus: "success",
          contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f001/CONTENT.md",
          read: false,
          categories: [],
          moments: [],
          tags: [],
          flashbacks: [],
          createdAt: new Date("2026-05-09T00:00:00.000Z"),
          updatedAt: new Date("2026-05-09T00:00:00.000Z"),
        },
        content: {
          relativePath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f001/CONTENT.md",
          variants: [],
        },
        rendered: {
          html: "<h1>Reader Title</h1>",
          toc: [],
        },
      }),
    ).toBeUndefined();
    expect(
      readerHttpStatusCode({
        status: "not_found",
        message: "Memory was not found.",
      }),
    ).toBe(404);
    expect(
      readerHttpStatusCode({
        status: "content_missing",
        message: "Readable content is missing for this memory.",
      }),
    ).toBe(404);
    expect(
      readerHttpStatusCode({
        status: "unavailable",
        message: "Reader content is unavailable.",
      }),
    ).toBe(503);
  });
});
