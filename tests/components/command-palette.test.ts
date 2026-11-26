import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isMemoryReaderPath } from "../../src/components/shell/AppShell";
import {
  buildCommandPaletteItems,
  extractFocusedMemoryId,
  extractMemoryIdFromPathname,
  isCommandPaletteShortcut,
  looksLikeCaptureUrl,
  OPEN_READER_PSYCHIATRIST_EVENT,
  submitMemoryTriageMove,
  validateCaptureUrl,
} from "../../src/components/shell/command-palette-model";
import { createFallbackFocusPluginContext } from "../../src/plugins/context";
import type { BrowseMemory } from "../../src/components/memories/browse-data";

const commandPaletteSource = readFileSync(
  "src/components/shell/CommandPalette.tsx",
  "utf8",
);
const dialogSource = readFileSync("src/components/ui/Dialog.tsx", "utf8");

const sampleMemory: BrowseMemory = {
  id: "mem-focus-1",
  title: "Reader Mode Notes",
  url: "https://example.com/reader-mode-notes",
  description: "Notes on focus-first reading.",
  capturedAt: "2026-11-25T00:00:00.000Z",
  read: false,
  extractionStatus: "success",
  categories: [],
  tags: [],
  flashbacks: [],
};

describe("command palette model", () => {
  it("matches Cmd+K and Ctrl+K shortcuts without matching plain or Alt+K keys", () => {
    expect(
      isCommandPaletteShortcut({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isCommandPaletteShortcut({
        key: "K",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isCommandPaletteShortcut({
        key: "k",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe(false);
    expect(
      isCommandPaletteShortcut({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
      }),
    ).toBe(false);
  });

  it("validates capture URLs and rejects empty or non-http URLs with clear messages", () => {
    expect(validateCaptureUrl("")).toEqual({
      ok: false,
      error: "Enter a URL before saving.",
    });
    expect(validateCaptureUrl("   ")).toEqual({
      ok: false,
      error: "Enter a URL before saving.",
    });
    expect(validateCaptureUrl("not-a-url")).toEqual({
      ok: false,
      error: "Enter a valid http:// or https:// URL.",
    });
    expect(validateCaptureUrl("javascript:alert(1)")).toEqual({
      ok: false,
      error: "Enter a valid http:// or https:// URL.",
    });
    expect(validateCaptureUrl("https://example.com/article")).toEqual({
      ok: true,
      url: "https://example.com/article",
    });
    expect(looksLikeCaptureUrl("https://example.com/a")).toBe(true);
    expect(looksLikeCaptureUrl("reader mode")).toBe(false);
  });

  it("extracts focused memory ids from reader paths and DOM elements", () => {
    expect(isMemoryReaderPath("/memories")).toBe(false);
    expect(isMemoryReaderPath("/memories/mem-1")).toBe(true);
    expect(isMemoryReaderPath("/memories/ja/mem-1")).toBe(true);

    expect(extractMemoryIdFromPathname("/memories")).toBeNull();
    expect(extractMemoryIdFromPathname("/memories/mem-1")).toBe("mem-1");
    expect(extractMemoryIdFromPathname("/memories/ja/mem-2")).toBe("mem-2");

    const fakeRowElement = {
      closest: (selector: string) =>
        selector === "[data-memory-id]"
          ? { getAttribute: () => "mem-row-9" }
          : null,
    } as unknown as Element;
    expect(extractFocusedMemoryId("/memories", fakeRowElement)).toBe(
      "mem-row-9",
    );

    const fakeLinkElement = {
      closest: (selector: string) =>
        selector === "a[href]"
          ? { getAttribute: () => "/memories/mem-link-4" }
          : null,
    } as unknown as Element;
    expect(extractFocusedMemoryId("/memories", fakeLinkElement)).toBe(
      "mem-link-4",
    );
  });

  it("builds navigation, search results, capture, lane moves, and focus plugin toggles", () => {
    const pluginContext = createFallbackFocusPluginContext();
    const items = buildCommandPaletteItems({
      query: "",
      searchResults: [sampleMemory],
      focusedMemoryId: "mem-focus-1",
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });

    expect(items.some((item) => item.kind === "memory" && item.memoryId === "mem-focus-1")).toBe(true);
    expect(items.some((item) => item.kind === "open-capture")).toBe(true);
    expect(items.some((item) => item.kind === "navigate" && item.href === "/memories")).toBe(true);
    expect(items.some((item) => item.kind === "navigate" && item.href === "/memories?lane=shelf")).toBe(true);
    expect(items.some((item) => item.kind === "navigate" && item.href === "/memories?lane=library")).toBe(true);
    expect(items.some((item) => item.kind === "navigate" && item.href === "/flashbacks")).toBe(true);
    expect(items.some((item) => item.kind === "navigate" && item.href === "/moments")).toBe(true);
    expect(items.some((item) => item.kind === "navigate" && item.href === "/settings")).toBe(true);
    expect(items.filter((item) => item.kind === "move-lane")).toHaveLength(4);
    expect(items.filter((item) => item.kind === "toggle-plugin").length).toBeGreaterThan(0);

    const withoutFocus = buildCommandPaletteItems({
      query: "",
      searchResults: [],
      focusedMemoryId: null,
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });
    expect(withoutFocus.filter((item) => item.kind === "move-lane")).toHaveLength(0);

    const urlItems = buildCommandPaletteItems({
      query: "https://example.com/fresh",
      searchResults: [],
      focusedMemoryId: null,
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });
    expect(urlItems[0]).toMatchObject({
      kind: "capture-url",
      url: "https://example.com/fresh",
    });
  });

  it("lists Open Psychiatrist only on reader routes and omits it on /memories", () => {
    const pluginContext = createFallbackFocusPluginContext();

    const browseItems = buildCommandPaletteItems({
      query: "",
      searchResults: [],
      focusedMemoryId: "mem-focus-1",
      isReaderRoute: isMemoryReaderPath("/memories"),
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });
    expect(
      browseItems.some(
        (item) =>
          item.kind === "open-psychiatrist" ||
          item.label === "Open Psychiatrist",
      ),
    ).toBe(false);

    const browseQueryItems = buildCommandPaletteItems({
      query: "Open Psychiatrist",
      searchResults: [],
      focusedMemoryId: "mem-focus-1",
      isReaderRoute: isMemoryReaderPath("/memories"),
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });
    expect(
      browseQueryItems.some((item) => item.kind === "open-psychiatrist"),
    ).toBe(false);

    const readerItems = buildCommandPaletteItems({
      query: "",
      searchResults: [],
      focusedMemoryId: "mem-focus-1",
      isReaderRoute: isMemoryReaderPath("/memories/mem-focus-1"),
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });
    expect(readerItems).toContainEqual(
      expect.objectContaining({
        id: "action-open-psychiatrist",
        section: "Actions",
        kind: "open-psychiatrist",
        label: "Open Psychiatrist",
      }),
    );

    const translatedReaderQueryItems = buildCommandPaletteItems({
      query: "psychiatrist",
      searchResults: [],
      focusedMemoryId: "mem-focus-1",
      isReaderRoute: isMemoryReaderPath("/memories/ja/mem-focus-1"),
      plugins: pluginContext.plugins(),
      isPluginEnabled: (id) => pluginContext.isPluginEnabled(id),
    });
    expect(
      translatedReaderQueryItems.filter(
        (item) => item.kind === "open-psychiatrist",
      ),
    ).toHaveLength(1);

    expect(OPEN_READER_PSYCHIATRIST_EVENT).toBe("trauma:open-reader-psychiatrist");
    expect(commandPaletteSource).toContain("OPEN_READER_PSYCHIATRIST_EVENT");
    expect(commandPaletteSource).toContain("isReaderRoute: props.isReaderRoute");
    const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
    expect(appShellSource).toContain("isReaderRoute={isReaderRoute()}");
  });

  it("submits memory triage moves and surfaces cap errors cleanly", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const okResult = await submitMemoryTriageMove({
      memoryId: "mem-1",
      triageState: "today",
      todayCap: 3,
      fetch: async (url, init) => {
        requests.push({ url, body: String(init.body ?? "") });
        return new Response(JSON.stringify({ triageState: "today" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(okResult).toEqual({ ok: true, triageState: "today" });
    expect(requests).toEqual([
      {
        url: "/api/memories/mem-1/triage",
        body: JSON.stringify({ triage_state: "today", todayCap: 3 }),
      },
    ]);

    const capResult = await submitMemoryTriageMove({
      memoryId: "mem-2",
      triageState: "today",
      todayCap: 3,
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "Today is full. Finish or return one first.",
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
    });
    expect(capResult).toEqual({
      ok: false,
      error: "Today is full. Finish or return one first.",
    });
  });

  it("reuses getBrowseMemoryPage, useFocusPlugins, and TraumaDialog with accessible error alerts", () => {
    expect(commandPaletteSource).toContain("getBrowseMemoryPage");
    expect(commandPaletteSource).toContain("useFocusPlugins");
    expect(commandPaletteSource).toContain('role="alert"');
    expect(commandPaletteSource).toContain("<TraumaDialog");
    expect(commandPaletteSource).toContain('ariaLabel="Command palette"');
    expect(commandPaletteSource).toContain('id="trauma-command-palette"');
    expect(commandPaletteSource).toContain('role="listbox"');
    expect(commandPaletteSource).not.toContain("category");
    expect(commandPaletteSource).not.toContain("tag");
    expect(commandPaletteSource).toContain("paletteSessionId");
    expect(commandPaletteSource).toContain('event.key === "Tab"');

    expect(dialogSource).toContain('import { Dialog as KobalteDialog } from "@kobalte/core/dialog"');
    expect(dialogSource).toContain("modal={true}");
    expect(dialogSource).toContain("<KobalteDialog.Portal>");
    expect(dialogSource).toContain("<KobalteDialog.Overlay");
    expect(dialogSource).toContain("<KobalteDialog.Content");
    expect(dialogSource).toContain("data-command-palette-backdrop");

    const memoryBrowseSource = readFileSync(
      "src/components/memories/MemoryBrowse.tsx",
      "utf8",
    );
    expect(memoryBrowseSource).toContain("data-memory-id={props.memory.id}");
  });
});
