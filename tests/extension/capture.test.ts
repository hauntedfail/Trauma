import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";

import { createCapturedTabSnapshot } from "../../extensions/browser/src/capture";

const originalLocation = globalThis.location;
const originalDocument = globalThis.document;
const originalElement = globalThis.Element;

afterEach(() => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: originalLocation,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: originalElement,
  });
});

describe("extension page capture", () => {
  it("extracts and sanitizes a generic article candidate", () => {
    installPage({
      href: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head>
            <title>Captured Article</title>
            <link rel="canonical" href="https://example.com/canonical">
            <meta name="description" content="Useful description">
          </head>
          <body>
            <article onclick="alert(1)">
              <h1>Captured Article</h1>
              <p>Readable paragraph.</p>
              <script>window.evil = true;</script>
              <iframe srcdoc="<script>evil()</script>"></iframe>
              <button>Do not import controls</button>
            </article>
          </body>
        </html>`,
    });

    const result = createCapturedTabSnapshot("0.1.0");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.snapshot).toMatchObject({
      sourceUrl: "https://example.com/article",
      canonicalUrl: "https://example.com/canonical",
      title: "Captured Article",
      description: "Useful description",
      selector: "article",
      extractionStrategy: "semantic_selector",
      extensionVersion: "0.1.0",
    });
    expect(result.snapshot.articleText).toContain("Readable paragraph.");
    expect(result.snapshot.articleHtml).toContain("Readable paragraph.");
    expect(result.snapshot.articleHtml).not.toContain("<script");
    expect(result.snapshot.articleHtml).not.toContain("onclick");
    expect(result.snapshot.articleHtml).not.toContain("<iframe");
    expect(result.snapshot.articleHtml).not.toContain("<button");
  });

  it("captures complete high-node articles when the byte budget allows it", () => {
    const paragraphs = Array.from(
      { length: 3_000 },
      (_value, index) => `<p>Readable paragraph ${index}.</p>`,
    ).join("");
    installPage({
      href: "https://example.com/long-article",
      html: `<!doctype html>
        <html>
          <head><title>Long Article</title></head>
          <body>
            <article>
              <h1>Long Article</h1>
              ${paragraphs}
            </article>
          </body>
        </html>`,
    });

    const result = createCapturedTabSnapshot("0.1.0", 1_000_000);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.snapshot.articleText).toContain("Readable paragraph 0.");
    expect(result.snapshot.articleText).toContain("Readable paragraph 2999.");
    expect(result.snapshot.articleHtml).toContain("Readable paragraph 2999.");
  });

  it("skips removable nodes before enforcing the capture byte budget", () => {
    installPage({
      href: "https://example.com/removable-budget",
      html: `<!doctype html>
        <html>
          <head><title>Removable Budget</title></head>
          <body>
            <article>
              <h1>Removable Budget</h1>
              <p>Readable content should survive even when ignored scripts are huge.</p>
              <script>${"ignored script ".repeat(1_000)}</script>
              <style>${".ignored { color: red; }".repeat(1_000)}</style>
            </article>
          </body>
        </html>`,
    });

    const result = createCapturedTabSnapshot("0.1.0", 2_000);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.snapshot.articleText).toContain("Readable content should survive");
    expect(result.snapshot.articleHtml).not.toContain("<script");
    expect(result.snapshot.articleHtml).not.toContain("<style");
  });

  it("preserves controlled HTTPS media while removing unsafe iframe forms", () => {
    installPage({
      href: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head><title>Captured Media Article</title></head>
          <body>
            <article>
              <h1>Captured Media Article</h1>
              <p>Readable media paragraph.</p>
              <img src="https://pbs.twimg.com/media/photo.jpg" alt="tweet image" onclick="evil()">
              <img src="http://cdn.example.net/http.jpg" alt="http image">
              <iframe src="https://embed.example.net/player" title="Video" onclick="evil()" allow="camera" width="640" height="360"></iframe>
              <iframe src="https://embed.example.net/inline" title="Inline" srcdoc="<p>inline</p>"></iframe>
              <iframe src="http://embed.example.net/player" title="HTTP"></iframe>
            </article>
          </body>
        </html>`,
    });

    const result = createCapturedTabSnapshot("0.1.0");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.snapshot.articleHtml).toContain(
      'src="https://pbs.twimg.com/media/photo.jpg"',
    );
    expect(result.snapshot.articleHtml).toContain(
      'src="https://embed.example.net/player"',
    );
    expect(result.snapshot.articleHtml).toContain('loading="lazy"');
    expect(result.snapshot.articleHtml).toContain('referrerpolicy="no-referrer"');
    expect(result.snapshot.articleHtml).toContain(
      'sandbox="allow-scripts allow-presentation"',
    );
    expect(result.snapshot.articleHtml).not.toContain("allow-same-origin");
    expect(result.snapshot.articleHtml).not.toContain("onclick");
    expect(result.snapshot.articleHtml).not.toContain("allow=\"camera\"");
    expect(result.snapshot.articleHtml).not.toContain("http.jpg");
    expect(result.snapshot.articleHtml).not.toContain("srcdoc");
    expect(result.snapshot.articleHtml).not.toContain("Inline");
    expect(result.snapshot.articleHtml).not.toContain("HTTP");
  });

  it("uses semantic selectors against open shadow roots in the live document", () => {
    installPage({
      href: "https://example.com/shadow-article",
      html: `<!doctype html>
        <html>
          <head>
            <title>Shadow Article</title>
            <link rel="canonical" href="https://example.com/shadow-article">
          </head>
          <body>
            <main id="app-shell"></main>
          </body>
        </html>`,
    });
    const host = document.getElementById("app-shell");
    if (host === null) {
      throw new Error("missing shadow host");
    }
    const shadowRoot = host.attachShadow({ mode: "open" });
    const article = document.createElement("article");
    article.innerHTML = `
      <h1>Shadow article</h1>
      <p>The article body is visible in the current tab.</p>
      <p>This content exists inside an open shadow root and must be read through the live document path.</p>
      <script>window.evil = true;</script>
    `;
    shadowRoot.append(article);

    const result = createCapturedTabSnapshot("0.1.0");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.snapshot).toMatchObject({
      sourceUrl: "https://example.com/shadow-article",
      canonicalUrl: "https://example.com/shadow-article",
      title: "Shadow Article",
      selector: "article",
      extractionStrategy: "semantic_selector",
      extensionVersion: "0.1.0",
    });
    expect(result.snapshot.articleText).toContain(
      "visible in the current tab",
    );
    expect(result.snapshot.articleHtml).toContain("Shadow article");
    expect(result.snapshot.articleHtml).not.toContain("<script");
  });

  it("does not full-scan the live document before applying the traversal cap", () => {
    installPage({
      href: "https://example.com/shadow-article",
      html: `<!doctype html>
        <html>
          <head><title>Shadow Article</title></head>
          <body><main id="app-shell"></main></body>
        </html>`,
    });
    const host = document.getElementById("app-shell");
    if (host === null) {
      throw new Error("missing shadow host");
    }
    const shadowRoot = host.attachShadow({ mode: "open" });
    const article = document.createElement("article");
    article.textContent =
      "The article body is visible inside the current tab shadow root.";
    shadowRoot.append(article);
    const documentPrototype = Object.getPrototypeOf(document) as {
      querySelectorAll: Document["querySelectorAll"];
    };
    const originalQuerySelectorAll = documentPrototype.querySelectorAll;
    documentPrototype.querySelectorAll = function (
      this: Document,
      selector: string,
    ) {
      if (selector === "*") {
        throw new Error("live document full scan");
      }

      return originalQuerySelectorAll.call(this, selector);
    };

    try {
      const result = createCapturedTabSnapshot("0.1.0");

      expect(result.ok).toBe(true);
    } finally {
      documentPrototype.querySelectorAll = originalQuerySelectorAll;
    }
  });

  it("does not full-scan the cloned document while sanitizing", () => {
    installPage({
      href: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head><title>Captured Article</title></head>
          <body>
            <article onclick="alert(1)">
              <h1>Captured Article</h1>
              <p>Readable paragraph.</p>
              <script>window.evil = true;</script>
            </article>
          </body>
        </html>`,
    });
    const elementPrototype = Object.getPrototypeOf(document.documentElement) as {
      querySelectorAll: Element["querySelectorAll"];
    };
    const originalQuerySelectorAll = elementPrototype.querySelectorAll;
    elementPrototype.querySelectorAll = function (
      this: Element,
      selector: string,
    ) {
      if (selector === "*") {
        throw new Error("cloned element full scan");
      }

      return originalQuerySelectorAll.call(this, selector);
    };

    try {
      const result = createCapturedTabSnapshot("0.1.0");

      expect(result.ok).toBe(true);
    } finally {
      elementPrototype.querySelectorAll = originalQuerySelectorAll;
    }
  });

  it("does not deep-clone the full document before bounded traversal", () => {
    installPage({
      href: "https://example.com/article",
      html: `<!doctype html>
        <html>
          <head><title>Captured Article</title></head>
          <body>
            <article>
              <h1>Captured Article</h1>
              <p>Readable paragraph that should survive a bounded shallow clone.</p>
            </article>
          </body>
        </html>`,
    });
    const elementPrototype = Object.getPrototypeOf(document.documentElement) as {
      cloneNode: Element["cloneNode"];
    };
    const originalCloneNode = elementPrototype.cloneNode;
    elementPrototype.cloneNode = function (this: Element, deep?: boolean) {
      if (deep === true) {
        throw new Error("full document deep clone");
      }

      return originalCloneNode.call(this, deep);
    };

    try {
      const result = createCapturedTabSnapshot("0.1.0");

      expect(result.ok).toBe(true);
    } finally {
      elementPrototype.cloneNode = originalCloneNode;
    }
  });

  it("rejects snapshots whose full JSON payload would exceed the byte budget", () => {
    installPage({
      href: "https://example.com/large-text",
      html: `<!doctype html>
        <html>
          <head><title>Large Text</title></head>
          <body>
            <article>
              <p>${"large text ".repeat(70)}</p>
            </article>
          </body>
        </html>`,
    });

    expect(createCapturedTabSnapshot("0.1.0", 900)).toEqual({
      ok: false,
      error: "The current page is too large to import.",
    });
  });

  it("rejects browser-internal pages", () => {
    installPage({
      href: "chrome://extensions",
      html: "<html><body>Internal page</body></html>",
    });

    expect(createCapturedTabSnapshot("0.1.0")).toEqual({
      ok: false,
      error: "TRAUMA can import only http and https pages.",
    });
  });
});

function installPage(input: { href: string; html: string }) {
  const { document, window } = parseHTML(input.html);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: window.Element,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL(input.href),
  });
}
