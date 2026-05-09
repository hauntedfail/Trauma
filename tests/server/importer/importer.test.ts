import { describe, expect, it } from "vitest";

import { importUrl } from "../../../src/server/importer";

describe("URL importer", () => {
  it("extracts article metadata and markdown through an injectable fetch boundary", async () => {
    const result = await importUrl({
      url: "https://example.com/posts/importable",
      fetch: async () =>
        new Response(
          `<!doctype html>
          <html>
            <head>
              <title>Fallback title</title>
              <meta property="og:title" content="Useful Article">
              <meta name="description" content="A useful import fixture.">
              <link rel="icon" href="/favicon.ico">
            </head>
            <body>
              <script>window.evil = true;</script>
              <article>
                <h1>Useful Article</h1>
                <p>This paragraph has enough readable words to be imported as article content for the markdown body.</p>
                <p>The importer should keep useful text and discard the raw HTML wrapper.</p>
              </article>
            </body>
          </html>`,
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          },
        ),
    });

    expect(result).toMatchObject({
      status: "success",
      url: "https://example.com/posts/importable",
      title: "Useful Article",
      description: "A useful import fixture.",
      faviconUrl: "https://example.com/favicon.ico",
    });

    if (result.status !== "success") {
      throw new Error(`expected success, got ${result.status}`);
    }

    expect(result.markdown).toContain("# Useful Article");
    expect(result.markdown).toContain("enough readable words");
    expect(result.markdown).not.toContain("<article");
    expect(result.markdown).not.toContain("<script");
  });

  it("returns a link-only fallback when fetch fails", async () => {
    const result = await importUrl({
      url: "https://example.com/offline",
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/offline",
      title: "example.com",
      extractionError: "fetch failed: network unavailable",
    });
  });

  it("returns a link-only fallback for insufficient article body", async () => {
    const result = await importUrl({
      url: "https://example.com/thin",
      fetch: async () =>
        new Response(
          `<!doctype html>
          <html>
            <head><title>Thin Page</title></head>
            <body><article><p>Too short.</p></article></body>
          </html>`,
          {
            headers: {
              "content-type": "text/html",
            },
          },
        ),
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/thin",
      title: "Thin Page",
      extractionError: "insufficient article body",
    });
  });
});
