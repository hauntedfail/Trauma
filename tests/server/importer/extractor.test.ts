import { describe, expect, it } from "vitest";

import {
  extractArticleWithDefuddle,
  readableMarkdownLength,
} from "../../../src/server/importer/extractor";

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

  it("preserves cross-host HTTPS article images without relaxing links", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/posts/importable",
      html: `<!doctype html>
        <html>
          <head><title>Cross Host Media Article</title></head>
          <body>
            <article>
              <h1>Cross Host Media Article</h1>
              <p>This article has enough readable words to preserve cross host article media without changing clickable link policy.</p>
              <p><a href="https://cdn.example.net/page">cross host link</a></p>
              <img src="https://pbs.twimg.com/media/photo.jpg" alt="tweet image">
              <picture>
                <source srcset="https://miro.medium.com/v2/resize:fit:960/format:webp/image.webp 960w" type="image/webp">
                <img src="https://miro.medium.com/v2/resize:fit:960/image.jpg" alt="medium image">
              </picture>
              <img src="http://cdn.example.net/http.jpg" alt="http image">
              <img src="data:image/png;base64,abc" alt="data image">
              <img src="https://token:secret@cdn.example.net/private.jpg" alt="userinfo image">
            </article>
          </body>
        </html>`,
    });

    expect(result.markdown).toContain(
      "![tweet image](https://pbs.twimg.com/media/photo.jpg)",
    );
    expect(result.markdown).toContain("<picture>");
    expect(result.markdown).toContain("https://miro.medium.com/v2/resize");
    expect(result.markdown).toContain("cross host link");
    expect(result.markdown).not.toContain("https://cdn.example.net/page");
    expect(result.markdown).not.toContain("http image");
    expect(result.markdown).not.toContain("data image");
    expect(result.markdown).not.toContain("userinfo image");
    expect(result.markdown).not.toContain("token:secret");
  });

  it("preserves controlled HTTPS iframes while stripping unsafe embed forms", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/posts/importable",
      html: `<!doctype html>
        <html>
          <head><title>Iframe Media Article</title></head>
          <body>
            <article>
              <h1>Iframe Media Article</h1>
              <p>This article has enough readable words to preserve controlled iframe embeds without accepting inline iframe HTML.</p>
              <iframe src="https://embed.example.net/player" title="Playable embed" onclick="evil()" srcdoc="<p>ignore</p>"></iframe>
              <iframe src="https://embed.example.net/player" title="Playable embed" allow="camera" width="640" height="360"></iframe>
              <iframe src="http://embed.example.net/player" title="HTTP embed"></iframe>
              <iframe src="https://localhost/player" title="Local embed"></iframe>
            </article>
          </body>
        </html>`,
    });

    expect(result.markdown).toContain("https://embed.example.net/player");
    expect(result.markdown).toContain('title="Playable embed"');
    expect(result.markdown).toContain('loading="lazy"');
    expect(result.markdown).toContain('referrerpolicy="no-referrer"');
    expect(result.markdown).toContain(
      'sandbox="allow-scripts allow-presentation"',
    );
    expect(result.markdown).not.toContain("allow-same-origin");
    expect(result.markdown).not.toContain("onclick");
    expect(result.markdown).not.toContain("srcdoc");
    expect(result.markdown).not.toContain("allow=\"camera\"");
    expect(result.markdown).not.toContain("HTTP embed");
    expect(result.markdown).not.toContain("Local embed");
  });

  it("preserves safe responsive image variants from extracted HTML", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head><title>Responsive Image Article</title></head>
          <body>
            <article>
              <h1>Responsive Image Article</h1>
              <p>This article has enough readable words to preserve responsive image metadata without changing extraction fallback behavior.</p>
              <picture>
                <source type="image/avif" srcset="/photo-480.avif 480w, /photo-960.avif 960w" sizes="(width <= 48rem) 90vw, 48rem">
                <img src="/photo-960.jpg" srcset="/photo-480.jpg 480w, /photo-960.jpg 960w" sizes="(width <= 48rem) 90vw, 48rem" alt="Diagram" width="960" height="540">
              </picture>
            </article>
          </body>
        </html>`,
    });

    expect(result.markdown).toContain("<picture>");
    expect(result.markdown).toContain(
      'srcset="https://example.com/photo-480.avif 480w, https://example.com/photo-960.avif 960w"',
    );
    expect(result.markdown).toContain('sizes="(width &lt;= 48rem) 90vw, 48rem"');
    expect(result.markdown).toContain('src="https://example.com/photo-960.jpg"');
  });

  it("preserves descriptor-less responsive image candidates from extracted HTML", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head><title>Descriptorless Responsive Image Article</title></head>
          <body>
            <article>
              <h1>Descriptorless Responsive Image Article</h1>
              <p>This article has enough readable words to preserve descriptorless responsive image candidates without dropping the source tag.</p>
              <picture>
                <source type="image/avif" srcset="/photo.avif">
                <img src="/photo.jpg" srcset="/photo-small.jpg 480w, /photo-large.jpg 960w" alt="Descriptorless diagram">
              </picture>
            </article>
          </body>
        </html>`,
    });

    expect(result.markdown).toContain("<picture>");
    expect(result.markdown).toContain('srcset="https://example.com/photo.avif"');
    expect(result.markdown).toContain('src="https://example.com/photo.jpg"');
  });

  it("removes unsafe responsive image candidates from extracted HTML", async () => {
    const result = await extractArticleWithDefuddle({
      pageUrl: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head><title>Unsafe Responsive Image Article</title></head>
          <body>
            <article>
              <h1>Unsafe Responsive Image Article</h1>
              <p>This article has enough readable words to reject unsafe responsive image metadata without changing extraction fallback behavior.</p>
              <picture>
                <source type="image/webp" srcset="javascript:alert(1) 480w, data:image/png;base64,abc 960w">
                <img src="/photo.jpg" srcset="javascript:alert(1) 480w, https://93.184.216.34/photo.jpg 960w" sizes="100vw" alt="Safe fallback">
              </picture>
            </article>
          </body>
        </html>`,
    });

    expect(result.markdown).toContain("![Safe fallback](https://example.com/photo.jpg)");
    expect(result.markdown).not.toContain("<picture>");
    expect(result.markdown).not.toContain("<source");
    expect(result.markdown).not.toContain("srcset=");
    expect(result.markdown).not.toContain("javascript:");
    expect(result.markdown).not.toContain("data:image");
    expect(result.markdown).not.toContain("93.184.216.34");
  });

  it("does not count preserved responsive picture markup as readable body text", () => {
    const markdown = `<picture>
<source srcset="https://example.com/empty-480.avif 480w, https://example.com/empty-960.avif 960w" sizes="100vw" type="image/avif">
<img src="https://example.com/empty.jpg" srcset="https://example.com/empty-480.jpg 480w, https://example.com/empty-960.jpg 960w" sizes="100vw" alt="Decorative image">
</picture>`;

    expect(readableMarkdownLength(markdown)).toBe(0);
  });
});
