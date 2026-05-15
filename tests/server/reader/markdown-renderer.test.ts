import { describe, expect, it } from "vitest";

import { renderMemoryMarkdown } from "../../../src/server/reader/markdown-renderer";

describe("renderMemoryMarkdown", () => {
  it("renders curated markdown features and table of contents", () => {
    const result = renderMemoryMarkdown([
      "# Reader Title",
      "",
      "Intro with [a link](https://example.com), https://example.org, and ~~old text~~.",
      "",
      "## Details",
      "",
      "- [x] saved",
      "- [ ] queued",
      "- first",
      "- second",
      "",
      "| Feature | State |",
      "| --- | --- |",
      "| tables | supported |",
      "",
      "```ts",
      "const memory = \"reader\";",
      "```",
      "",
      "Footnote marker[^1].",
      "",
      "[^1]: Footnote body.",
    ].join("\n"));

    expect(result.toc).toEqual([
      { id: "reader-title", level: 1, path: "1", text: "Reader Title" },
      { id: "details", level: 2, path: "1/1", text: "Details" },
    ]);
    expect(result.html).toContain('<h1 id="reader-title"');
    expect(result.html).toContain('data-reader-section-anchor="reader-title"');
    expect(result.html).toContain('data-reader-section-path="1"');
    expect(result.html).toContain('<a href="https://example.com"');
    expect(result.html).toContain('<a href="https://example.org"');
    expect(result.html).toContain("<s>old text</s>");
    expect(result.html).toContain('class="task-list-item-checkbox"');
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain('checked="checked"');
    expect(result.html).toContain("<table>");
    expect(result.html).toContain('<code class="hljs language-ts">');
    expect(result.html).toContain("footnote-ref");
    expect(result.html).toContain("Footnote body.");
  });

  it("removes unsafe HTML while preserving persisted highlight marks", () => {
    const result = renderMemoryMarkdown([
      '<script>alert("xss")</script>',
      '<img src="x" onerror="alert(1)">',
      '<a href="javascript:alert(1)" onclick="alert(1)">unsafe link</a>',
      "<mark>plain mark</mark>",
      '<mark data-highlight-id="018f04a2-3c6-7c88-9a8b-8c99a9b7f001" onclick="alert(1)">saved highlight</mark>',
    ].join("\n"));

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onerror");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("<mark>plain mark</mark>");
    expect(result.html).toContain(
      '<mark data-highlight-id="018f04a2-3c6-7c88-9a8b-8c99a9b7f001" id="018f04a2-3c6-7c88-9a8b-8c99a9b7f001">saved highlight</mark>',
    );
  });

  it("allows controlled HTTPS iframes through the shared reader policy", () => {
    const result = renderMemoryMarkdown([
      '<iframe src="https://embed.example.test/player" title="Allowed video" referrerpolicy="unsafe-url" sandbox="allow-forms" onclick="evil()" width="640" height="360"></iframe>',
      '<iframe src="http://embed.example.test/player" title="HTTP blocked"></iframe>',
      '<iframe src="https://localhost/player" title="Local blocked"></iframe>',
      '<iframe srcdoc="<p>inline</p>" src="https://embed.example.test/inline" title="Srcdoc blocked"></iframe>',
    ].join("\n"));

    expect(result.html).toContain(
      '<iframe src="https://embed.example.test/player" title="Allowed video"',
    );
    expect(result.html).toContain('width="640"');
    expect(result.html).toContain('height="360"');
    expect(result.html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation"',
    );
    expect(result.html).toContain('loading="lazy"');
    expect(result.html).toContain('referrerpolicy="no-referrer"');
    expect(result.html).not.toContain('referrerpolicy="unsafe-url"');
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("allow-forms");
    expect(result.html).not.toContain(" allow=");
    expect(result.html).not.toContain("http://embed.example.test");
    expect(result.html).not.toContain("localhost");
    expect(result.html).not.toContain("srcdoc");
    expect(result.html).not.toContain("Srcdoc blocked");
  });

  it("preserves sanitized responsive image markup", () => {
    const result = renderMemoryMarkdown([
      "<picture>",
      '<source type="image/avif" media="(width <= 48rem)" srcset="https://cdn.example.test/photo-480.avif 480w, https://cdn.example.test/photo-960.avif 960w" sizes="(width <= 48rem) 90vw, 48rem">',
      '<source type="image/webp" srcset="https://cdn.example.test/photo-480.webp 480w, https://cdn.example.test/photo-960.webp 960w" sizes="(width <= 48rem) 90vw, 48rem">',
      '<img src="https://cdn.example.test/photo-960.jpg" srcset="https://cdn.example.test/photo-480.jpg 480w, https://cdn.example.test/photo-960.jpg 960w" sizes="(width <= 48rem) 90vw, 48rem" alt="Diagram" width="960" height="540">',
      "</picture>",
    ].join(""));

    expect(result.html).toContain("<picture>");
    expect(result.html).toContain('<source type="image/avif"');
    expect(result.html).toContain(
      'srcset="https://cdn.example.test/photo-480.avif 480w, https://cdn.example.test/photo-960.avif 960w"',
    );
    expect(result.html).toContain('sizes="(width &lt;= 48rem) 90vw, 48rem"');
    expect(result.html).toContain('src="https://cdn.example.test/photo-960.jpg"');
    expect(result.html).toContain('loading="lazy"');
    expect(result.html).toContain('decoding="async"');
  });

  it("preserves descriptor-less responsive image candidates", () => {
    const result = renderMemoryMarkdown([
      "<picture>",
      '<source type="image/avif" srcset="https://cdn.example.test/photo.avif">',
      '<img src="https://cdn.example.test/photo.jpg" srcset="https://cdn.example.test/photo-480.jpg 480w, https://cdn.example.test/photo-960.jpg 960w" alt="Descriptorless diagram">',
      "</picture>",
    ].join(""));

    expect(result.html).toContain("<picture>");
    expect(result.html).toContain('<source type="image/avif"');
    expect(result.html).toContain('srcset="https://cdn.example.test/photo.avif"');
    expect(result.html).toContain('src="https://cdn.example.test/photo.jpg"');
  });

  it("strips unsafe responsive image candidates", () => {
    const result = renderMemoryMarkdown([
      '<img src="https://cdn.example.test/photo.jpg" srcset="javascript:alert(1) 320w, https://cdn.example.test/photo-640.jpg 640w, data:image/png;base64,abc 960w" sizes="100vw" alt="Safe">',
      '<source srcset="javascript:alert(1) 320w" type="image/webp">',
    ].join(""));

    expect(result.html).toContain('src="https://cdn.example.test/photo.jpg"');
    expect(result.html).toContain('srcset="https://cdn.example.test/photo-640.jpg 640w"');
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("data:image");
    expect(result.html).not.toContain("<source");
  });
});
