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
      { id: "reader-title", level: 1, text: "Reader Title" },
      { id: "details", level: 2, text: "Details" },
    ]);
    expect(result.html).toContain('<h1 id="reader-title"');
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
      '<mark data-highlight-id="018f04a2-3c6-7c88-9a8b-8c99a9b7f001">saved highlight</mark>',
    );
  });

  it("allows only controlled external embeds", () => {
    const result = renderMemoryMarkdown([
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Allowed video" referrerpolicy="unsafe-url"></iframe>',
      '<iframe src="https://player.vimeo.com/video/123" title="Allowed Vimeo" allow="camera; microphone; geolocation; clipboard-write"></iframe>',
      '<iframe src="https://evil.example/embed" title="Blocked video"></iframe>',
    ].join("\n"));

    expect(result.html).toContain(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Allowed video"',
    );
    expect(result.html).toContain('referrerpolicy="no-referrer"');
    expect(result.html).not.toContain('referrerpolicy="unsafe-url"');
    expect(result.html).not.toContain("camera");
    expect(result.html).not.toContain("microphone");
    expect(result.html).not.toContain("geolocation");
    expect(result.html).not.toContain("clipboard-write");
    expect(result.html).not.toContain(" allow=");
    expect(result.html).not.toContain("evil.example");
    expect(result.html).not.toContain("Blocked video");
  });
});
