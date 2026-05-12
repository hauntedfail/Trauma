import { describe, expect, it } from "vitest";

import {
  BrowserImportError,
  importBrowserCapture,
  type BrowserImportPayload,
} from "../../../src/server/browser-import";

describe("browser capture import", () => {
  it("extracts browser-captured HTML and creates a memory through the existing path", async () => {
    const payload = createPayload({
      canonicalUrl: "https://example.com/canonical",
      title: "Captured fallback title",
      description: "Captured fallback description",
      html: `<!doctype html>
        <html>
          <head>
            <title>Document fallback</title>
            <meta property="og:title" content="Captured Article">
          </head>
          <body>
            <article>
              <h1>Captured Article</h1>
              <p>This browser captured article contains enough readable words to become a memory through the existing persistence path.</p>
              <p>The extension provides loaded HTML, but the server still owns extraction and markdown generation.</p>
            </article>
          </body>
        </html>`,
    });
    const observedUrls: string[] = [];

    const memory = await importBrowserCapture({
      payload,
      config: createConfig(),
      db: {} as never,
      backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
      createMemory: async (input) => {
        observedUrls.push(input.url);
        const imported = await input.importer?.importUrl({ url: input.url });
        expect(imported).toMatchObject({
          status: "success",
          url: "https://example.com/canonical",
          title: "Captured Article",
        });
        expect(imported?.status === "success" ? imported.markdown : "").toContain(
          "server still owns extraction",
        );
        return { id: "memory-id" };
      },
    });

    expect(memory).toEqual({ id: "memory-id" });
    expect(observedUrls).toEqual(["https://example.com/canonical"]);
  });

  it("does not create link-only memories when browser capture extraction fails", async () => {
    await expect(
      importBrowserCapture({
        payload: createPayload({ html: "<html><body>thin</body></html>" }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        createMemory: async () => {
          throw new Error("createMemory should not be called");
        },
      }),
    ).rejects.toEqual(new BrowserImportError("extracted page content is too short"));
  });
});

function createPayload(
  overrides: Partial<BrowserImportPayload> = {},
): BrowserImportPayload {
  return {
    sourceUrl: "https://example.com/source",
    canonicalUrl: null,
    title: null,
    description: null,
    html: "<html></html>",
    capturedAt: "2026-05-12T12:00:00.000Z",
    extensionVersion: "0.1.0",
    ...overrides,
  };
}

function createConfig() {
  return {
    configFilePath: "/tmp/trauma.config.json",
    projectPath: "/tmp/trauma",
    storePath: "/tmp/trauma/store",
    databasePath: "/tmp/trauma.sqlite",
    backup: {
      git: {
        enabled: false,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup memory {memoryId}",
      },
    },
  };
}
