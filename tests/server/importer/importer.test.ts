import { describe, expect, it } from "vitest";

import {
  createPinnedFetch,
  importUrl,
  validateImportUrl,
} from "../../../src/server/importer";

describe("URL importer", () => {
  it("extracts article metadata and markdown through an injectable fetch boundary", async () => {
    const result = await importUrl({
      url: "https://example.com/posts/importable",
      resolveHostname: async () => ["93.184.216.34"],
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
      resolveHostname: async () => ["93.184.216.34"],
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
      resolveHostname: async () => ["93.184.216.34"],
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

  it("rejects local URLs before fetch to prevent server-side request forgery", async () => {
    await expect(
      importUrl({
        url: "http://localhost/admin",
        fetch: async () => {
          throw new Error("fetch should not be called");
        },
      }),
    ).rejects.toThrow(/public HTTP/);
  });

  it("rejects private redirect targets before following them", async () => {
    const requestedUrls: string[] = [];
    const result = await importUrl({
      url: "https://example.com/redirect",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async (url, init) => {
        requestedUrls.push(url);
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: {
            location: "http://127.0.0.1/admin",
          },
        });
      },
    });

    expect(requestedUrls).toEqual(["https://example.com/redirect"]);
    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/redirect",
      title: "example.com",
      extractionError: "fetch failed: url must target a public HTTP(S) host",
    });
  });

  it("rejects non-global IP spellings before fetch", async () => {
    await expect(validateImportUrl("http://[::ffff:127.0.0.1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[::]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[fe90::1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[ff02::1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://100.64.0.1/")).rejects.toThrow(
      /public HTTP/,
    );
  });

  it("rejects URLs containing userinfo before persistence", async () => {
    await expect(
      validateImportUrl("https://token:secret@example.com/article", {
        resolveHostname: async () => ["93.184.216.34"],
      }),
    ).rejects.toThrow(/userinfo/);
  });

  it("keeps unsafe display URLs out of extracted markdown", async () => {
    const result = await importUrl({
      url: "https://example.com/article",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response(
          `<!doctype html>
          <html>
            <head><title>Unsafe Display Links</title></head>
            <body>
              <article>
                <p>This article has enough readable body text to pass extraction and exercise markdown URL handling.</p>
                <p><a href="javascript://example.com/%0aalert(1)">unsafe link</a></p>
                <p><a href="/redirect?next=)">reader link</a></p>
                <p><img src="/image).png" alt="diagram"></p>
              </article>
            </body>
          </html>`,
          {
            headers: {
              "content-type": "text/html",
            },
          },
        ),
    });

    if (result.status !== "success") {
      throw new Error(`expected success, got ${result.status}`);
    }

    expect(result.markdown).toContain("unsafe link");
    expect(result.markdown).not.toContain("javascript:");
    expect(result.markdown).toContain(
      "[reader link](https://example.com/redirect?next=\\))",
    );
    expect(result.markdown).toContain("![diagram](https://example.com/image\\).png)");
  });

  it("escapes markdown syntax that came from article text nodes", async () => {
    const result = await importUrl({
      url: "https://example.com/text-markdown",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response(
          `<!doctype html>
          <html>
            <head><title>Text Markdown</title></head>
            <body>
              <article>
                <p>This article has enough readable body text to pass extraction.</p>
                <p>[click](javascript:alert(1)) &lt;img src=x onerror=alert(1)&gt;</p>
                <p><a href="/safe">safe link</a></p>
              </article>
            </body>
          </html>`,
          {
            headers: {
              "content-type": "text/html",
            },
          },
        ),
    });

    if (result.status !== "success") {
      throw new Error(`expected success, got ${result.status}`);
    }

    expect(result.markdown).toContain("\\[click\\](javascript:alert(1))");
    expect(result.markdown).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(result.markdown).toContain("[safe link](https://example.com/safe)");
    expect(result.markdown).not.toContain("[click](javascript:");
    expect(result.markdown).not.toContain("<img src=x");
  });

  it("cancels non-OK response bodies before falling back", async () => {
    let canceled = false;
    const result = await importUrl({
      url: "https://example.com/server-error",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel: () => {
              canceled = true;
            },
          }),
          {
            status: 500,
            headers: {
              "content-type": "text/html",
            },
          },
        ),
    });

    expect(result.status).toBe("link_only");
    expect(canceled).toBe(true);
  });

  it("cancels non-HTML response bodies before falling back", async () => {
    let canceled = false;
    const result = await importUrl({
      url: "https://example.com/plain-text",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel: () => {
              canceled = true;
            },
          }),
          {
            headers: {
              "content-type": "text/plain",
            },
          },
        ),
    });

    expect(result.status).toBe("link_only");
    expect(canceled).toBe(true);
  });

  it("returns a link-only fallback before reading oversized responses", async () => {
    const result = await importUrl({
      url: "https://example.com/huge",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response("<html></html>", {
          headers: {
            "content-length": "2000001",
            "content-type": "text/html",
          },
        }),
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/huge",
      title: "example.com",
      extractionError: "response too large: 2000001 bytes exceeds 2000000",
    });
  });

  it("returns timeout fallback when DNS resolution finishes after the request is aborted", async () => {
    const result = await importUrl({
      url: "https://example.com/slow-dns",
      timeoutMs: 1,
      resolveHostname: async () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(["93.184.216.34"]), 10);
        }),
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/slow-dns",
      title: "example.com",
      extractionError: "fetch failed: request timed out",
    });
  });

  it("tries later validated DNS addresses when an earlier public address fails", async () => {
    const requestedAddresses: string[] = [];
    const fetch = createPinnedFetch(
      async () => ["2001:4860:4860::8888", "93.184.216.34"],
      async (_url, address) => {
        requestedAddresses.push(address);
        if (requestedAddresses.length === 1) {
          throw new Error("network unreachable");
        }

        return new Response(
          `<!doctype html>
          <html>
            <head><title>Retried Address</title></head>
            <body>
              <article>
                <p>This article has enough readable words to confirm fallback to the second resolved address.</p>
                <p>The importer should keep trying already validated public DNS answers before giving up.</p>
              </article>
            </body>
          </html>`,
          {
            headers: {
              "content-type": "text/html",
            },
          },
        );
      },
    );

    const response = await fetch("https://example.com/dual-stack");

    expect(requestedAddresses).toEqual([
      "2001:4860:4860::8888",
      "93.184.216.34",
    ]);
    expect(response.ok).toBe(true);
  });
});
