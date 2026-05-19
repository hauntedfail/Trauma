import { describe, expect, it } from "vitest";

import { extractArticleWithDefuddle } from "../../../src/server/importer/extractor";

describe("extractArticleWithDefuddle", () => {
  it("extracts metadata and uses Defuddle markdown output as the reader source", async () => {
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
            </article>
            <footer>footer clutter</footer>
          </body>
        </html>`,
    });

    expect(result.title).toBe("Useful Article");
    expect(result.description).toBe("A useful import fixture.");
    expect(result.faviconUrl).toBe("https://example.com/favicon.ico");
    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.markdown).toContain("enough readable words");
    expect(result.markdown).toContain("[safe link]");
    expect(result.markdown).not.toContain("<article");
    expect(result.markdown).not.toContain("navigation clutter");
    expect(result.markdown).not.toContain("sidebar clutter");
    expect(result.markdown).not.toContain("footer clutter");
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

  it("preserves short non-empty Defuddle markdown for the importer boundary", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/short",
      html: `<!doctype html>
        <html>
          <head><title>Short Page</title></head>
          <body><article><p>Too short.</p></article></body>
        </html>`,
    });

    expect(result.title).toBe("Short Page");
    expect(result.markdown).toContain("Too short.");
  });
});
