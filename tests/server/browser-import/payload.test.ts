import { describe, expect, it } from "vitest";

import { parseBrowserImportPayload } from "../../../src/server/browser-import";

const now = new Date("2026-05-12T12:00:00.000Z");

describe("browser import payload validation", () => {
  it("normalizes a valid browser capture payload", () => {
    const result = parseBrowserImportPayload(
      JSON.stringify({
        sourceUrl: " https://example.com/article ",
        canonicalUrl: "https://example.com/canonical",
        title: " Example title ",
        description: " Description ",
        html: "<html><body><article>Readable body</article></body></html>",
        capturedAt: "2026-05-12T11:59:00.000Z",
        extensionVersion: "0.1.0",
      }),
      { maxBytes: 5_000_000, now: () => now },
    );

    expect(result).toEqual({
      ok: true,
      payload: {
        sourceUrl: "https://example.com/article",
        canonicalUrl: "https://example.com/canonical",
        title: "Example title",
        description: "Description",
        html: "<html><body><article>Readable body</article></body></html>",
        capturedAt: "2026-05-12T11:59:00.000Z",
        extensionVersion: "0.1.0",
      },
    });
  });

  it("rejects unsafe URLs, stale captures, unknown fields, and oversized bodies", () => {
    expect(
      parseBrowserImportPayload(
        JSON.stringify({
          sourceUrl: "chrome://extensions",
          html: "<html></html>",
          capturedAt: now.toISOString(),
          extensionVersion: "0.1.0",
        }),
        { maxBytes: 5_000_000, now: () => now },
      ),
    ).toEqual({ ok: false, error: "sourceUrl must use http or https" });

    expect(
      parseBrowserImportPayload(
        JSON.stringify({
          sourceUrl: "https://user@example.com/article",
          html: "<html></html>",
          capturedAt: now.toISOString(),
          extensionVersion: "0.1.0",
        }),
        { maxBytes: 5_000_000, now: () => now },
      ),
    ).toEqual({ ok: false, error: "sourceUrl must not include userinfo" });

    expect(
      parseBrowserImportPayload(
        JSON.stringify({
          sourceUrl: "https://example.com/article",
          html: "<html></html>",
          capturedAt: "2026-05-12T11:00:00.000Z",
          extensionVersion: "0.1.0",
        }),
        { maxBytes: 5_000_000, now: () => now },
      ),
    ).toEqual({
      ok: false,
      error: "capturedAt must be within 10 minutes of server time",
    });

    expect(
      parseBrowserImportPayload(
        JSON.stringify({
          sourceUrl: "https://example.com/article",
          html: "<html></html>",
          capturedAt: now.toISOString(),
          extensionVersion: "0.1.0",
          extra: true,
        }),
        { maxBytes: 5_000_000, now: () => now },
      ),
    ).toEqual({ ok: false, error: "unexpected field: extra" });

    expect(
      parseBrowserImportPayload(
        JSON.stringify({
          sourceUrl: "https://example.com/article",
          html: "<html></html>",
          capturedAt: now.toISOString(),
          extensionVersion: "0.1.0",
        }),
        { maxBytes: 10, now: () => now },
      ),
    ).toEqual({ ok: false, error: "request body is too large" });
  });
});
