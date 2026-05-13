import { describe, expect, it } from "vitest";

import { extractArticleWithDefuddle } from "../../../src/server/importer/extractor";

describe("extractArticleWithDefuddle", () => {
  it("extracts readable content and serializes safe markdown from Defuddle HTML", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/posts/importable",
      html: `<!doctype html>
        <html>
          <head>
            <title>Fallback title</title>
            <meta property="og:title" content="Useful Article">
            <meta name="description" content="A useful import fixture.">
            <link rel="icon" href="/favicon.ico">
          </head>
          <body>
            <header>site header</header>
            <nav>navigation clutter</nav>
            <aside>sidebar clutter</aside>
            <article>
              <h1>Useful Article</h1>
              <p>This paragraph has enough readable words to be imported as article content for the markdown body.</p>
              <p><a href="/safe">safe link</a></p>
              <p><a href="javascript:alert(1)">unsafe link</a></p>
              <p>[click](javascript:alert(1)) &lt;img src=x onerror=alert(1)&gt;</p>
              <img src="/image).png" alt="diagram">
            </article>
            <footer>footer clutter</footer>
          </body>
        </html>`,
    });

    expect(result.title).toBe("Useful Article");
    expect(result.description).toBe("A useful import fixture.");
    expect(result.faviconUrl).toBe("https://example.com/favicon.ico");
    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.markdown).toContain("# Useful Article");
    expect(result.markdown).toContain("enough readable words");
    expect(result.markdown).toContain("[safe link](https://example.com/safe)");
    expect(result.markdown).toContain("unsafe link");
    expect(result.markdown).toContain(
      "\\[click\\\\]\\(javascript:alert\\(1\\)\\)",
    );
    expect(result.markdown).toContain("&lt;img src=x onerror=alert\\(1\\)&gt;");
    expect(result.markdown).toContain("![diagram](https://example.com/image\\).png)");
    expect(result.markdown).not.toContain("navigation clutter");
    expect(result.markdown).not.toContain("sidebar clutter");
    expect(result.markdown).not.toContain("footer clutter");
    expect(result.markdown).not.toContain("<article");
    expect(result.markdown).not.toContain("[click](javascript:");
    expect(result.markdown).not.toContain("<img src=x");
  });

  it("returns empty markdown when Defuddle cannot identify readable content", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/empty",
      html: `<!doctype html>
        <html>
          <head><title>Empty Page</title></head>
          <body><nav>Navigation only</nav></body>
        </html>`,
    });

    expect(result.title).toBe("Empty Page");
    expect(result.markdown).toBe("");
  });

  it("does not preserve public IP links or images from a named source host", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/posts/importable",
      html: `<!doctype html>
        <html>
          <head><title>IP Linked Article</title></head>
          <body>
            <article>
              <h1>IP Linked Article</h1>
              <p>This article has enough readable words to exercise extracted link sanitization for source host boundaries.</p>
              <p><a href="https://93.184.216.34/private">public IP link</a></p>
              <img src="https://93.184.216.34/pixel.png" alt="pixel">
            </article>
          </body>
        </html>`,
    });

    expect(result.markdown).toContain("public IP link");
    expect(result.markdown).not.toContain("https://93.184.216.34");
    expect(result.markdown).not.toContain("![pixel]");
  });
});
