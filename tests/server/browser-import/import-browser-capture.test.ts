import { describe, expect, it } from "vitest";

import {
  BrowserImportError,
  importBrowserCapture,
  type BrowserImportPayload,
  type ImportBrowserCaptureInput,
} from "../../../src/server/browser-import";

describe("browser capture import", () => {
  it("uses browser-extracted article HTML without fetching the current tab URL", async () => {
    const payload = createPayload({
      canonicalUrl: "https://example.com/canonical",
      title: "Captured fallback title",
      description: "Captured fallback description",
      articleHtml: `<article>
        <h1>Captured Article</h1>
        <p>This browser extracted article contains enough readable words to become a memory through the existing persistence path.</p>
        <p>The extension provides selected article HTML, while Defuddle owns markdown generation.</p>
      </article>`,
      articleText:
        "Captured Article. This browser extracted article contains enough readable words to become a memory through the existing persistence path. The extension provides selected article HTML.",
      selector: "article",
      extractionStrategy: "semantic_selector",
    });
    const observedUrls: string[] = [];

    const memory = await importCapture({
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
          title: "Captured fallback title",
        });
        expect(imported?.status === "success" ? imported.markdown : "").toContain(
          "Defuddle owns markdown generation",
        );
        return { id: "memory-id" };
      },
    });

    expect(memory).toEqual({ id: "memory-id" });
    expect(observedUrls).toEqual(["https://example.com/canonical"]);
  });

  it("rejects empty Defuddle markdown without building a browser-capture markdown fallback", async () => {
    await expect(
      importCapture({
        payload: createPayload({
          articleHtml: `<article>
            <h1>Captured Article</h1>
            <p>This browser capture has enough visible text that only the extractor output should decide persistence.</p>
          </article>`,
          articleText:
            "Captured Article. This browser capture has enough visible text that only the extractor output should decide persistence.",
        }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        extractArticle: async () => ({
          title: "Captured Article",
          description: null,
          faviconUrl: null,
          markdown: "",
          wordCount: 0,
        }),
        createMemory: async () => {
          throw new Error("createMemory should not be called");
        },
      }),
    ).rejects.toEqual(
      new BrowserImportError("failed to extract readable page content"),
    );
  });

  it("bounds browser capture extraction time before persisting a memory", async () => {
    await expect(
      importCapture({
        payload: createPayload({
          articleHtml: `<article>
            <h1>Captured Article</h1>
            <p>This browser extracted article contains enough readable words to reach the server extraction step.</p>
          </article>`,
          articleText:
            "Captured Article. This browser extracted article contains enough readable words to reach the server extraction step.",
        }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        extractionTimeoutMs: 1,
        extractArticle: async () => new Promise(() => undefined),
        createMemory: async () => {
          throw new Error("createMemory should not be called");
        },
      }),
    ).rejects.toEqual(
      new BrowserImportError("failed to extract readable page content"),
    );
  });

  it("imports short non-empty Defuddle markdown without falling back to captured HTML markdown", async () => {
    const payload = createPayload({
      sourceUrl: "https://x.com/seelffff/status/2054991798519656789",
      title: "Short media post",
      articleHtml: `<article>
        <p>Short post text.</p>
        <img src="https://pbs.twimg.com/media/example.jpg" alt="Captured source image">
      </article>`,
      articleText: "Short post text.",
    });
    const observedMarkdown: string[] = [];

    const memory = await importCapture({
      payload,
      config: createConfig(),
      db: {} as never,
      backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
      extractArticle: async () => ({
        title: "Short media post",
        description: null,
        faviconUrl: null,
        markdown: "Short post text.",
        wordCount: 3,
      }),
      createMemory: async (input) => {
        const imported = await input.importer?.importUrl({ url: input.url });
        if (imported?.status !== "success") {
          throw new Error("expected successful import");
        }
        observedMarkdown.push(imported.markdown);
        return { id: "memory-id" };
      },
    });

    expect(memory).toEqual({ id: "memory-id" });
    expect(observedMarkdown).toEqual(["Short post text."]);
  });

  it("does not persist a memory when synchronous extraction work exceeds the timeout", async () => {
    const startedAt = Date.now();

    await expect(
      importCapture({
        payload: createPayload({
          articleHtml: `<article>
            <h1>Captured Article</h1>
            <p>This browser extracted article contains enough readable words to reach the server extraction step.</p>
          </article>`,
          articleText:
            "Captured Article. This browser extracted article contains enough readable words to reach the server extraction step.",
        }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        extractionTimeoutMs: 1,
        extractArticle: () => {
          const stopAt = Date.now() + 25;
          while (Date.now() < stopAt) {
            // Simulate synchronous parser work before the first await.
          }

          return Promise.resolve({
            title: "Captured",
            description: null,
            faviconUrl: null,
            markdown:
              "# Captured\n\nThis browser extracted article contains enough readable words to reach the server extraction step.",
            wordCount: 15,
          });
        },
        createMemory: async () => {
          throw new Error("createMemory should not be called");
        },
      }),
    ).rejects.toEqual(
      new BrowserImportError("failed to extract readable page content"),
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
  });

  it("falls back to the captured source URL when canonical URL is private", async () => {
    const observedUrls: string[] = [];

    const memory = await importCapture({
      payload: createPayload({
        canonicalUrl: "http://127.0.0.1/admin",
        articleHtml: `<article>
          <h1>Captured Article</h1>
          <p>This browser extracted article contains enough readable words to become a memory through the existing persistence path.</p>
          <p>The private canonical target must not replace the user-visible source URL.</p>
        </article>`,
        articleText:
          "Captured Article. This browser extracted article contains enough readable words to become a memory through the existing persistence path. The private canonical target must not replace the user-visible source URL.",
      }),
      config: createConfig(),
      db: {} as never,
      backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
      createMemory: async (input) => {
        observedUrls.push(input.url);
        const imported = await input.importer?.importUrl({ url: input.url });
        expect(imported?.url).toBe("https://example.com/source");
        return { id: "memory-id" };
      },
    });

    expect(memory).toEqual({ id: "memory-id" });
    expect(observedUrls).toEqual(["https://example.com/source"]);
  });

  it("falls back to the captured source URL when canonical URL is a different public IP", async () => {
    const observedUrls: string[] = [];

    const memory = await importCapture({
      payload: createPayload({
        canonicalUrl: "https://93.184.216.34/canonical",
        articleHtml: `<article>
          <h1>Captured Article</h1>
          <p>This browser extracted article contains enough readable words to become a memory through the existing persistence path.</p>
          <p>A canonical IP must not replace the user selected source URL.</p>
        </article>`,
        articleText:
          "Captured Article. This browser extracted article contains enough readable words to become a memory through the existing persistence path. A canonical IP must not replace the user selected source URL.",
      }),
      config: createConfig(),
      db: {} as never,
      backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
      extractArticle: async () => ({
        title: "Captured Article",
        description: null,
        faviconUrl: null,
        markdown:
          "# Captured Article\n\nThis browser extracted article contains enough readable words to become a memory through the existing persistence path.",
        wordCount: 15,
      }),
      createMemory: async (input) => {
        observedUrls.push(input.url);
        const imported = await input.importer?.importUrl({ url: input.url });
        expect(imported?.url).toBe("https://example.com/source");
        return { id: "memory-id" };
      },
    });

    expect(memory).toEqual({ id: "memory-id" });
    expect(observedUrls).toEqual(["https://example.com/source"]);
  });

  it("rejects source hostnames that resolve to a private address", async () => {
    await expect(
      importCapture({
        payload: createPayload({
          sourceUrl: "https://split-horizon.example/article",
        }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        resolveHostname: async () => ["127.0.0.1"],
        extractArticle: async () => ({
          title: "Captured Article",
          description: null,
          faviconUrl: null,
          markdown: "# Captured Article\n\nPrivate content must not be imported.",
          wordCount: 8,
        }),
        createMemory: async () => ({ id: "must-not-be-created" }),
      }),
    ).rejects.toEqual(new BrowserImportError("source URL is not allowed"));
  });

  it("falls back to a validated source when canonical DNS becomes private", async () => {
    const observedUrls: string[] = [];
    let resolutionCount = 0;

    await importCapture({
      payload: createPayload({
        canonicalUrl: "https://example.com/canonical",
      }),
      config: createConfig(),
      db: {} as never,
      backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
      resolveHostname: async () => {
        resolutionCount += 1;
        return resolutionCount === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
      },
      extractArticle: async () => ({
        title: "Captured Article",
        description: null,
        faviconUrl: null,
        markdown: "# Captured Article\n\nOnly validated public URLs may persist.",
        wordCount: 8,
      }),
      createMemory: async (input) => {
        observedUrls.push(input.url);
        return { id: "memory-id" };
      },
    });

    expect(resolutionCount).toBe(2);
    expect(observedUrls).toEqual(["https://example.com/source"]);
  });

  it("rejects localhost subdomain source URLs", async () => {
    await expect(
      importCapture({
        payload: createPayload({
          sourceUrl: "http://app.localhost:5173/article",
          articleHtml: `<article>
            <h1>Captured Article</h1>
            <p>This browser extracted article contains enough readable words to reach source URL validation.</p>
          </article>`,
          articleText:
            "Captured Article. This browser extracted article contains enough readable words to reach source URL validation.",
        }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        createMemory: async () => {
          throw new Error("createMemory should not be called");
        },
      }),
    ).rejects.toEqual(new BrowserImportError("source URL is not allowed"));
  });
});

function importCapture(input: ImportBrowserCaptureInput) {
  return importBrowserCapture({
    resolveHostname: async () => ["93.184.216.34"],
    ...input,
  });
}

function createPayload(
  overrides: Partial<BrowserImportPayload> = {},
): BrowserImportPayload {
  return {
    sourceUrl: "https://example.com/source",
    canonicalUrl: null,
    title: null,
    description: null,
    articleHtml: "<article></article>",
    articleText: "",
    selector: "article",
    extractionStrategy: "semantic_selector",
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
