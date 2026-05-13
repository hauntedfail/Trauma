import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserImportError,
  importBrowserCapture,
  type BrowserImportPayload,
} from "../../../src/server/browser-import";

describe("browser capture import", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses browser-extracted article HTML without fetching the current tab URL", async () => {
    const payload = createPayload({
      canonicalUrl: "https://example.com/canonical",
      title: "Captured fallback title",
      description: "Captured fallback description",
      articleHtml: `<article>
        <h1>Captured Article</h1>
        <p>This browser extracted article contains enough readable words to become a memory through the existing persistence path.</p>
        <p>The extension provides selected article HTML, but the server still owns markdown generation.</p>
      </article>`,
      articleText:
        "Captured Article. This browser extracted article contains enough readable words to become a memory through the existing persistence path. The extension provides selected article HTML.",
      selector: "article",
      extractionStrategy: "semantic_selector",
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
          title: "Captured fallback title",
        });
        expect(imported?.status === "success" ? imported.markdown : "").toContain(
          "server still owns markdown generation",
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
        payload: createPayload({
          articleHtml: "<article>thin</article>",
          articleText: "thin",
        }),
        config: createConfig(),
        db: {} as never,
        backupQueue: { enqueue: async () => ({ backupStatus: "pending" }) },
        createMemory: async () => {
          throw new Error("createMemory should not be called");
        },
      }),
    ).rejects.toEqual(new BrowserImportError("extracted page content is too short"));
  });

  it("bounds browser capture extraction time before persisting a memory", async () => {
    vi.useFakeTimers();
    const importPromise = importBrowserCapture({
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
      extractionTimeoutMs: 5,
      extractArticle: async () => new Promise(() => undefined),
      createMemory: async () => {
        throw new Error("createMemory should not be called");
      },
    });

    const expectation = expect(importPromise).rejects.toEqual(
      new BrowserImportError("failed to extract readable page content"),
    );
    await vi.advanceTimersByTimeAsync(5);
    await expectation;
  });

  it("falls back to the captured source URL when canonical URL is private", async () => {
    const observedUrls: string[] = [];

    const memory = await importBrowserCapture({
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
});

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
