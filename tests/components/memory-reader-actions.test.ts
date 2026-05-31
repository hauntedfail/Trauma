import { readFileSync } from "node:fs";

import { createSignal, type JSX } from "solid-js";
import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  attachReaderCategoryByName,
  attachReaderTagByName,
  deleteReaderMemory,
  detachReaderTagByName,
  MemoryReader,
  startReaderTranslation,
} from "../../src/components/reader/MemoryReader";
import { RightRailContentContext } from "../../src/components/shell/right-rail-context";
import type { BrowseTaxonomySummaryItem } from "../../src/components/memories/browse-data";
import type { SupportedLanguageCode } from "../../src/settings/languages";
import type { ReaderMemoryResult } from "../../src/server/reader/page-data";

const memoryReaderRouteSource = readFileSync(
  "src/routes/memories/[id].tsx",
  "utf8",
);
const memoryReaderSource = readFileSync(
  "src/components/reader/MemoryReader.tsx",
  "utf8",
);

const readyResult = {
  status: "ready",
  memory: {
    id: "memory-reader",
    url: "https://example.com/reader",
    title: "Reader Memory",
    description: "Reader description",
    faviconUrl: null,
    extractionStatus: "success",
    contentPath: "memories/memory-reader/CONTENT.md",
    read: true,
    categories: [{ id: "category-reader", name: "Reader" }],
    moments: [],
    tags: [{ id: "tag-solid", name: "solid" }],
    flashbacks: [
      {
        id: "flashback-1",
        text: "flashback",
        prefix: "A ",
        suffix: ".",
        startOffset: 2,
        endOffset: 11,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
        createdAt: "2026-05-09T00:00:00.000Z",
      },
    ],
    createdAt: new Date("2026-05-09T00:00:00.000Z"),
    updatedAt: new Date("2026-05-09T00:00:00.000Z"),
  },
  content: {
    relativePath: "memories/memory-reader/CONTENT.md",
    variants: [
      {
        active: true,
        kind: "source",
        label: "Original",
        readerUrl: "/memories/memory-reader",
        relativePath: "memories/memory-reader/CONTENT.md",
      },
    ],
  },
  rendered: {
    html: '<h1 id="reader-memory">Reader Memory</h1><p>A <mark data-flashback-id="flashback-1" id="flashback-1">flashback</mark>.</p>',
    toc: [{ id: "reader-memory", level: 1, path: "1", text: "Reader Memory" }],
  },
} satisfies ReaderMemoryResult;

describe("memory reader actions", () => {
  it("renders shared actions, read status, attached taxonomy, tag add control, and existing flashbacks", () => {
    const html = renderReader(readyResult, {
      tagOptions: [
        {
          id: "tag-global",
          name: "global",
          memoryCount: 1,
          lastAssignedAt: null,
        },
      ],
    });

    expect(html).toContain("Memory actions for Reader Memory");
    expect(html).toContain('aria-label="Mark memory unread"');
    expect(html).toContain('data-read-status-icon="read"');
    expect(html).not.toContain(">Read<");
    expect(html).not.toContain("Mark unread");
    expect(html).toContain("Reader");
    expect(html).toContain("solid");
    expect(html).toContain("Add tag");
    expect(html).toContain('data-taxonomy-create-trigger="true"');
    expect(html).toContain('data-flashback-id="flashback-1"');
    expect(html).not.toContain("Global category");
    expect(html).not.toContain("#global");
  });

  it("renders the reader title before taxonomy without hiding the body h1", () => {
    const html = renderReader({
      ...readyResult,
      memory: {
        ...readyResult.memory,
        categories: [{ id: "category-order", name: "Category After Title" }],
      },
      rendered: {
        html: '<h1 data-reader-section-anchor="reader-memory"><mark data-flashback-id="title-flashback" id="title-flashback">Reader Memory</mark></h1><p>Body</p>',
        toc: [{ id: "reader-memory", level: 1, path: "1", text: "Reader Memory" }],
      },
    });

    const introTitleIndex = html.indexOf("data-reader-section-anchor=\"reader-memory\"");
    const categoryIndex = html.indexOf("Category After Title");
    const flashbackIndex = html.indexOf("data-flashback-id=\"title-flashback\"");
    const bodyIndex = html.indexOf("<p>Body</p>");

    expect(introTitleIndex).toBeGreaterThan(-1);
    expect(categoryIndex).toBeGreaterThan(-1);
    expect(flashbackIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(introTitleIndex).toBeLessThan(categoryIndex);
    expect(categoryIndex).toBeLessThan(bodyIndex);
    expect(html.match(/data-reader-section-anchor="reader-memory"/g)).toHaveLength(1);
  });

  it("does not render empty attached taxonomy sections", () => {
    const html = renderReader({
      ...readyResult,
      memory: {
        ...readyResult.memory,
        categories: [],
        moments: [],
        flashbacks: [],
        tags: [],
      },
    });

    expect(html).not.toContain("No categories");
    expect(html).not.toContain("No tags");
    expect(html).toContain("Add tag");
  });

  it("revalidates the active translated reader cache after reader-local actions", () => {
    expect(memoryReaderSource).toContain(
      [
        "        revalidateAfterFlashbackToggle(",
        "          props.result.memory.id,",
        "          props.result.content.langCode,",
        "        ),",
      ].join("\n"),
    );
    expect(memoryReaderSource).toContain(
      [
        "                    revalidateAfterReadStatusChange(",
        "                      props.result.memory.id,",
        "                      props.result.content.langCode,",
        "                    )",
      ].join("\n"),
    );
    expect(memoryReaderSource).toContain(
      [
        "      void revalidateAfterReaderTaxonomyChange(",
        "        props.result.memory.id,",
        "        props.result.content.langCode,",
        "      );",
      ].join("\n"),
    );
  });

  it("keeps Flashback toggles invalidating reader, global Flashbacks, and browse pages", () => {
    const revalidationSource = memoryReaderSource.slice(
      memoryReaderSource.indexOf("async function revalidateAfterFlashbackToggle"),
      memoryReaderSource.indexOf("function ReaderContextMenu"),
    );

    expect(revalidationSource).toContain("revalidateFlashbackBrowseRows()");
    expect(revalidationSource).toContain("revalidateReaderMemory(memoryId, langCode)");
    expect(revalidationSource).toContain("revalidateBrowseMemoryWorkspace()");
  });

  it("keeps browser EventSource retries alive for transient translation stream errors", () => {
    const onErrorIndex = memoryReaderSource.indexOf("eventSource.onerror = () => {");
    expect(onErrorIndex).toBeGreaterThan(-1);
    const onErrorBody = memoryReaderSource.slice(
      onErrorIndex,
      memoryReaderSource.indexOf("  };", onErrorIndex),
    );
    expect(onErrorBody).toContain("Translation stream disconnected. Reconnecting...");
    expect(onErrorBody).toContain('status: "running"');
  });

  it("fails closed translation streams instead of leaving progress reconnecting", () => {
    const onErrorIndex = memoryReaderSource.indexOf("eventSource.onerror = () => {");
    expect(onErrorIndex).toBeGreaterThan(-1);
    const onErrorBody = memoryReaderSource.slice(
      onErrorIndex,
      memoryReaderSource.indexOf("  };", onErrorIndex),
    );
    expect(onErrorBody).toContain("eventSource.readyState === EventSource.CLOSED");
    expect(onErrorBody).toContain("Translation stream failed. Retry translation.");
    expect(onErrorBody).toContain('status: "failed"');
    expect(onErrorBody).toContain("eventSource.close()");
    expect(onErrorBody).toContain("translationEventSource = undefined");
  });

  it("treats terminal translation snapshots as terminal SSE progress", () => {
    expect(memoryReaderSource).toContain("TERMINAL_TRANSLATION_SNAPSHOT_STATUSES");
    expect(memoryReaderSource).toContain("isCompletedTranslationEnvelope(envelope)");
    expect(memoryReaderSource).toContain("isTerminalTranslationEnvelope(envelope)");
    expect(memoryReaderSource).toContain(
      "readTranslationSnapshotStatus(envelope.data) === \"complete\"",
    );
  });

  it("deletes the active memory and navigates back to memories", async () => {
    const requests: Request[] = [];
    const navigations: string[] = [];
    const revalidated: string[] = [];

    await deleteReaderMemory({
      memoryId: "memory-reader",
      navigate: (path) => navigations.push(path),
      revalidate: async (memoryId) => {
        revalidated.push(memoryId);
      },
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-reader", "DELETE"],
    ]);
    expect(revalidated).toEqual(["memory-reader"]);
    expect(navigations).toEqual(["/memories"]);
  });

  it("keeps the reader on the current page when delete fails", async () => {
    const navigations: string[] = [];

    await expect(
      deleteReaderMemory({
        memoryId: "memory-reader",
        navigate: (path) => navigations.push(path),
        fetch: async () => new Response(null, { status: 500 }),
      }),
    ).rejects.toThrow("failed to delete memory");

    expect(navigations).toEqual([]);
  });

  it("attaches a category by name through the memory category API", async () => {
    const requests: Request[] = [];

    const category = await attachReaderCategoryByName({
      memoryId: "memory-reader",
      name: "Research",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(
          JSON.stringify({
            category: { id: "category-research", name: "Research" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(category).toEqual({ id: "category-research", name: "Research" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/categories", "POST"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-reader",
      name: "Research",
    });
  });

  it("attaches a tag by name through the memory tag API", async () => {
    const requests: Request[] = [];

    const tag = await attachReaderTagByName({
      memoryId: "memory-reader",
      name: "typescript",
      fetch: async (input, init) => {
        requests.push(
          new Request(new URL(String(input), "http://localhost"), init),
        );
        return new Response(
          JSON.stringify({
            tag: { id: "tag-typescript", name: "typescript" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(tag).toEqual({ id: "tag-typescript", name: "typescript" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/tags", "POST"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-reader",
      name: "typescript",
    });
  });

  it("starts reader translation through the memory translation API", async () => {
    const requests: Request[] = [];

    const result = await startReaderTranslation({
      langCode: "ja-JP",
      memoryId: "memory-reader",
      model: "gpt-5.5",
      reasoningEffort: "high",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(
          JSON.stringify({
            status: "started",
            event_url: "/api/translation-jobs/job-reader/events",
            job_id: "job-reader",
            lang_code: "ja-JP",
            memory_id: "memory-reader",
            source_hash: "sha256:source",
          }),
          {
            status: 202,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(result).toMatchObject({
      event_url: "/api/translation-jobs/job-reader/events",
      status: "started",
    });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-reader/translations", "POST"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      lang_code: "ja-JP",
      model: "gpt-5.5",
      reasoning_effort: "high",
    });
  });

  it("branches reader translation API errors by stable code", async () => {
    await expect(
      startReaderTranslation({
        langCode: "ja-JP",
        memoryId: "memory-reader",
        fetch: async () =>
          new Response(
            JSON.stringify({
              status: "error",
              code: "auth_required",
              message: "raw auth message",
              action: "setup_codex_auth",
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
    ).rejects.toThrow("Codex ChatGPT sign-in is required before translation can run.");

    await expect(
      startReaderTranslation({
        langCode: "ja-JP",
        memoryId: "memory-reader",
        fetch: async () =>
          new Response(
            JSON.stringify({
              status: "error",
              code: "app_server_protocol_error",
              message: "thread/start.environments requires experimentalApi capability",
              action: "none",
            }),
            {
              status: 502,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
  ).rejects.toThrow(
      "Codex app-server rejected the translation request. Update the integration and retry.",
    );
  });

  it("renders the reader translation trigger as a popup opener", () => {
    const html = renderReader(readyResult, {
      translationTargetLanguage: "ja-JP",
      translationModel: "gpt-5.5",
      translationReasoningEffort: "high",
    });

    expect(html).toContain('aria-label="Translate memory"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(">Translate<");
    expect(memoryReaderSource).toContain(
      "setTranslationDialogOpen(open)",
    );
    expect(memoryReaderSource).toContain("translationFormModel");
    expect(memoryReaderSource).toContain("reasoning_effort");
  });

  it("uses the shared Popup shell for reader translation settings", () => {
    expect(memoryReaderSource).toContain('import { Popup } from "../ui/Popup"');
    expect(memoryReaderSource).toContain("<Popup");
    expect(memoryReaderSource).toContain(
      'label="Translation settings"',
    );
    expect(memoryReaderSource).toContain(
      "onOpenChange={handleTranslationPopoverOpenChange}",
    );
    expect(memoryReaderSource).toContain("onSubmit={submitTranslationDialog(close)}");
    expect(memoryReaderSource).not.toContain(
      'class="absolute right-0 top-12 z-20 grid w-[min(18rem,calc(100vw-2rem))] gap-3 rounded-[18px] border border-trauma-border bg-trauma-bg-elev/50 p-3 text-left shadow-lg backdrop-blur"',
    );
  });

  it("keeps remembered model values selectable and the submit button primary", () => {
    expect(memoryReaderSource).toContain("canonicalTranslationModel");
    expect(memoryReaderSource).toContain("submitCodexTranslationDefaults");
    expect(memoryReaderSource).toContain(
      "!translationCatalogModels().some((model) =>",
    );
    expect(memoryReaderSource).toContain(
      "model.model === translationFormModel()",
    );
    expect(memoryReaderSource).toContain(
      "selected={translationFormModel() === model.model}",
    );
    expect(memoryReaderSource).toContain(
      "selected={translationFormEffort() === effort}",
    );
    expect(memoryReaderSource).toContain("setTranslationProgress(undefined)");
    expect(memoryReaderSource).toContain("bg-trauma-accent");
    expect(memoryReaderSource).toContain("text-trauma-accent-ink");
    expect(memoryReaderSource).toContain("hover:bg-trauma-accent-hover");
    expect(memoryReaderSource).not.toContain("bg-trauma-accent/50");
  });

  it("persists reader-selected Codex defaults before translation start revalidation", () => {
    const persistIndex = memoryReaderSource.indexOf(
      "await submitCodexTranslationDefaults",
    );
    const defaultUpdateIndex = memoryReaderSource.indexOf(
      "setTranslationDefaultLanguage(input.langCode)",
      persistIndex,
    );
    const startIndex = memoryReaderSource.indexOf(
      "await startReaderTranslation",
      persistIndex,
    );
    const revalidateIndex = memoryReaderSource.indexOf(
      "void revalidateSettingsState()",
      persistIndex,
    );

    expect(persistIndex).toBeGreaterThan(-1);
    expect(defaultUpdateIndex).toBeGreaterThan(persistIndex);
    expect(defaultUpdateIndex).toBeLessThan(startIndex);
    expect(revalidateIndex).toBeGreaterThan(defaultUpdateIndex);
    expect(revalidateIndex).toBeLessThan(startIndex);
    expect(startIndex).toBeGreaterThan(persistIndex);
    expect(memoryReaderSource).toContain("codexTranslationModel");
    expect(memoryReaderSource).toContain("codexTranslationReasoningEffort");
  });

  it("validates the selected translation language before submitting", () => {
    expect(memoryReaderSource).toContain("hasTranslationVariant");
    expect(memoryReaderSource).toContain(
      "canStartTranslation(langCode)",
    );
    expect(memoryReaderSource).toContain(
      "!hasTranslationVariant(langCode)",
    );
  });

  it("keeps translation settings available when another target language is untranslated", () => {
    const html = renderReader({
      ...readyResult,
      content: {
        ...readyResult.content,
        variants: [
          {
            active: true,
            kind: "source",
            label: "Original",
            readerUrl: "/memories/memory-reader",
            relativePath: "memories/memory-reader/CONTENT.md",
          },
          {
            active: false,
            kind: "translation",
            label: "Japanese",
            langCode: "ja-JP",
            readerUrl: "/memories/ja-JP/memory-reader",
            relativePath: "memories/memory-reader/ja-JP/CONTENT.md",
          },
        ],
      },
    }, {
      translationTargetLanguage: "ja-JP",
    });

    expect(html).toContain('aria-label="Memory content variants"');
    expect(html).toContain(">Original<");
    expect(html).toContain(">Japanese<");
    expect(html).toContain('href="/memories/ja-JP/memory-reader"');
    expect(html).toContain('aria-label="Translate memory"');
    expect(memoryReaderSource).toContain("canOpenTranslationSettings");
    expect(memoryReaderSource).toContain("SUPPORTED_TRANSLATION_LANGUAGES.some");
    expect(memoryReaderSource).toContain("canStartTranslation(option.code)");
  });

  it("hides translation settings on translated reader variants", () => {
    const html = renderReader({
      ...readyResult,
      content: {
        ...readyResult.content,
        langCode: "ja-JP",
      },
    }, {
      translationTargetLanguage: "en-US",
    });

    expect(html).not.toContain('aria-label="Translate memory"');
  });

  it("detaches a tag by name through the memory tag API", async () => {
    const requests: Request[] = [];

    const tag = await detachReaderTagByName({
      memoryId: "memory-reader",
      name: "solid",
      fetch: async (input, init) => {
        requests.push(
          new Request(new URL(String(input), "http://localhost"), init),
        );
        return new Response(
          JSON.stringify({
            tag: { id: "tag-solid", name: "solid" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(tag).toEqual({ id: "tag-solid", name: "solid" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/tags", "DELETE"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-reader",
      name: "solid",
    });
  });

  it("passes reader tag options from the route taxonomy loader", () => {
    expect(memoryReaderRouteSource).toContain(
      "tagOptions={taxonomy()?.tags ?? []}",
    );
    expect(memoryReaderRouteSource).toContain(
      "categoryOptions={taxonomy()?.categories ?? []}",
    );
  });

  it("passes persisted reader translation settings from the route loader", () => {
    expect(memoryReaderRouteSource).toContain(
      "getReaderTranslationSettingsState",
    );
    expect(memoryReaderRouteSource).toContain(
      "translationModel={settings()?.codexTranslationModel}",
    );
    expect(memoryReaderRouteSource).toContain(
      "translationReasoningEffort={settings()?.codexTranslationReasoningEffort}",
    );
    expect(memoryReaderRouteSource).toContain(
      "translationTargetLanguage={settings()?.translationTargetLanguage}",
    );
  });
});

function renderReader(
  result: ReaderMemoryResult,
  options: {
    tagOptions?: readonly BrowseTaxonomySummaryItem[];
    translationModel?: string | null;
    translationReasoningEffort?: "high" | null;
    translationTargetLanguage?: SupportedLanguageCode;
  } = {},
): string {
  return renderToString(() => {
    const [rightRailContent, setRightRailContent] =
      createSignal<JSX.Element | undefined>();

    return createComponent(RightRailContentContext.Provider, {
      value: {
        rightRailContent,
        setRightRailContent,
      },
      get children() {
        return createComponent(MemoryReader, {
          flashbackRows: [],
          navigate: () => {},
          result,
          tagOptions: options.tagOptions ?? [],
          translationModel: options.translationModel,
          translationReasoningEffort: options.translationReasoningEffort,
          translationTargetLanguage: options.translationTargetLanguage,
        });
      },
    });
  });
}
