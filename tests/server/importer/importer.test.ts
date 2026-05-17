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

  it("requests identity encoding so pinned responses are read as text", async () => {
    const observedHeaders: Headers[] = [];
    const result = await importUrl({
      url: "https://example.com/identity",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async (_url, init) => {
        observedHeaders.push(new Headers(init?.headers));
        return new Response(
          `<!doctype html>
          <html>
            <head><title>Identity Encoding</title></head>
            <body>
              <article>
                <p>This article has enough readable words to confirm importer requests avoid compressed socket bytes.</p>
                <p>The pinned Node request path asks servers for identity transfer encoding before markdown extraction.</p>
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
    });

    expect(result.status).toBe("success");
    expect(observedHeaders[0]?.get("accept-encoding")).toBe("identity");
  });

  it("imports short non-empty extracted markdown without applying a Trauma readability threshold", async () => {
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

    expect(result).toMatchObject({
      status: "success",
      url: "https://example.com/thin",
      title: "Thin Page",
    });
    expect(result.status === "success" ? result.markdown : "").toContain(
      "Too short.",
    );
  });

  it("returns a link-only fallback when extraction returns blank markdown", async () => {
    const result = await importUrl({
      url: "https://example.com/blank-extraction",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response("<html><head><title>Blank Extraction</title></head><body></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
      extractArticle: async () => ({
        title: "Blank Extraction",
        description: null,
        faviconUrl: null,
        markdown: "",
        wordCount: 0,
      }),
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/blank-extraction",
      title: "Blank Extraction",
      extractionError: "empty article body",
    });
  });

  it("returns a link-only fallback when extraction fails", async () => {
    const result = await importUrl({
      url: "https://example.com/extractor-error",
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response("<html><head><title>Extractor Error</title></head><body></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
      extractArticle: async () => {
        throw new Error("Defuddle could not parse content");
      },
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/extractor-error",
      title: "example.com",
      extractionError: "extraction failed",
    });
  });

  it("times out fetch implementations that ignore abort signals", async () => {
    const result = await importUrl({
      url: "https://example.com/hung-fetch",
      timeoutMs: 1,
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () => new Promise<Response>(() => {}),
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/hung-fetch",
      title: "example.com",
      extractionError: "fetch failed: request timed out",
    });
  });

  it("keeps the import timeout active while extracting article content", async () => {
    const result = await importUrl({
      url: "https://example.com/slow-extraction",
      timeoutMs: 1,
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response("<html><head><title>Slow Extraction</title></head><body></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
      extractArticle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          title: "Slow Extraction",
          description: null,
          faviconUrl: null,
          markdown:
            "# Slow Extraction\n\nThis delayed extraction result should not win after the configured import timeout has elapsed.",
          wordCount: 14,
        };
      },
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/slow-extraction",
      title: "example.com",
      extractionError: "extraction failed: request timed out",
    });
  });

  it("does not persist extraction output produced after synchronous work exceeds the import budget", async () => {
    const result = await importUrl({
      url: "https://example.com/slow-sync-extraction",
      timeoutMs: 1,
      resolveHostname: async () => ["93.184.216.34"],
      fetch: async () =>
        new Response("<html><head><title>Slow Sync Extraction</title></head><body></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
      extractArticle: () => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 25) {
          // Intentionally block to prove late synchronous work cannot win the import.
        }

        return Promise.resolve({
          title: "Should Not Persist",
          description: null,
          faviconUrl: null,
          markdown:
            "# Should Not Persist\n\nThis delayed synchronous extraction result should not be stored after timeout.",
          wordCount: 13,
        });
      },
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/slow-sync-extraction",
      title: "example.com",
      extractionError: "extraction failed: request timed out",
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
    await expect(validateImportUrl("http://192.0.2.1/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://192.88.99.2/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[2001:2::1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[2001:1::4]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[2001:10::1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[3fff::1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(validateImportUrl("http://[2002::1]/")).rejects.toThrow(
      /public HTTP/,
    );
    await expect(
      validateImportUrl("http://[64:ff9b::10.0.0.1]/"),
    ).rejects.toThrow(/public HTTP/);
    await expect(validateImportUrl("http://192.0.3.1/")).resolves.toBe(
      "http://192.0.3.1/",
    );
    await expect(validateImportUrl("http://[64:ff9b::93.184.216.34]/")).resolves
      .toBe("http://[64:ff9b::5db8:d822]/");
    await expect(validateImportUrl("http://[2001:1::1]/")).resolves.toBe(
      "http://[2001:1::1]/",
    );
    await expect(validateImportUrl("http://[2001:20::1]/")).resolves.toBe(
      "http://[2001:20::1]/",
    );
    await expect(validateImportUrl("http://[2001:4860:4860::8888]/")).resolves
      .toBe("http://[2001:4860:4860::8888]/");
  });

  it("rejects URLs containing userinfo before persistence", async () => {
    await expect(
      validateImportUrl("https://token:secret@example.com/article", {
        resolveHostname: async () => ["93.184.216.34"],
      }),
    ).rejects.toThrow(/userinfo/);
  });

  it("keeps Defuddle extracted markdown at the importer boundary", async () => {
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
                <p><a href="/redirect?next=(">opening paren link</a></p>
                <p><a href="/search?q=a&amp;page=2">decoded query link</a></p>
                <p><a href="/search?q=a&#38;page=3">decimal entity query link</a></p>
                <p><a href="/search?q=a&#x26;page=4">hex entity query link</a></p>
                <p><a href="https://token:secret@example.com/private">credential link</a></p>
                <p><a href="https://assets.internal.example/private">private DNS link</a></p>
                <p><img src="/image).png" alt="diagram"></p>
                <p><img src="https://localhost/pixel.png" alt="local image"></p>
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
    expect(result.markdown).toContain(
      "[opening paren link](https://example.com/redirect?next=\\()",
    );
    expect(result.markdown).toContain(
      "[decoded query link](https://example.com/search?q=a&page=2)",
    );
    expect(result.markdown).toContain(
      "[decimal entity query link](https://example.com/search?q=a&page=3)",
    );
    expect(result.markdown).toContain(
      "[hex entity query link](https://example.com/search?q=a&page=4)",
    );
    expect(result.markdown).toContain("credential link");
    expect(result.markdown).toContain("private DNS link");
    expect(result.markdown).toContain("local image");
    expect(result.markdown).not.toContain("amp;page");
    expect(result.markdown).not.toContain("&#38;");
    expect(result.markdown).not.toContain("&#x26;");
    expect(result.markdown).toContain("![diagram](https://example.com/image).png)");
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
                <p># fake heading</p>
                <p>- fake item with **bold** and \`code\`</p>
                <ul><li>generated list item with **escaped text**</li></ul>
                <h2>Generated heading with **escaped text**</h2>
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
    expect(result.markdown).toContain("<img src=x onerror=alert(1)>");
    expect(result.markdown).toContain("\\# fake heading");
    expect(result.markdown).toContain(
      "\\- fake item with \\*\\*bold\\*\\* and \\`code\\`",
    );
    expect(result.markdown).toContain(
      "- generated list item with \\*\\*escaped text\\*\\*",
    );
    expect(result.markdown).toContain(
      "## Generated heading with \\*\\*escaped text\\*\\*",
    );
    expect(result.markdown).toContain("[safe link](https://example.com/safe)");
    expect(result.markdown).not.toContain("[click](javascript:");
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

  it("includes initial DNS validation in the import timeout budget", async () => {
    const result = await importUrl({
      url: "https://example.com/initial-slow-dns",
      timeoutMs: 1,
      resolveHostname: async () => new Promise(() => {}),
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/initial-slow-dns",
      title: "example.com",
      extractionError: "fetch failed: request timed out",
    });
  });

  it("includes pinned DNS validation in the import timeout budget", async () => {
    let resolveCalls = 0;
    const result = await importUrl({
      url: "https://example.com/pinned-slow-dns",
      timeoutMs: 1,
      resolveHostname: async () => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return ["93.184.216.34"];
        }

        return new Promise(() => {});
      },
    });

    expect(result).toEqual({
      status: "link_only",
      url: "https://example.com/pinned-slow-dns",
      title: "example.com",
      extractionError: "fetch failed: request timed out",
    });
    expect(resolveCalls).toBe(2);
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
