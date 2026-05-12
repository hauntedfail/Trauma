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
  it("sanitizes active content while preserving article HTML", () => {
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
      extensionVersion: "0.1.0",
    });
    expect(result.snapshot.html).toContain("Readable paragraph.");
    expect(result.snapshot.html).not.toContain("<script");
    expect(result.snapshot.html).not.toContain("onclick");
    expect(result.snapshot.html).not.toContain("<iframe");
    expect(result.snapshot.html).not.toContain("<button");
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
