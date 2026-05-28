import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  attachCategoryToMemoryByName,
  attachTagToMemoryByName,
  deleteBrowseMemory,
  detachTagFromMemoryByName,
  isBackupFailsafeMemoryActionError,
  MemoryItem,
} from "../../src/components/memories/MemoryBrowse";
import type { BrowseMemory } from "../../src/components/memories/browse-data";

const memory = {
  id: "memory-1",
  title: "Imported Memory",
  url: "https://example.com/imported",
  description: "Imported description",
  capturedAt: "2026-05-14",
  read: false,
  extractionStatus: "success",
  categories: [{ id: "research", name: "Research" }],
  tags: [{ id: "sqlite", name: "sqlite" }],
  flashbacks: [],
} satisfies BrowseMemory;
const browseSource = readFileSync("src/components/memories/MemoryBrowse.tsx", "utf8");
const searchBarSource = readFileSync("src/components/memories/MemorySearchBar.tsx", "utf8");

describe("memory browse actions", () => {
  it("renders actions, read status, and attached taxonomy", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory,
        selectedFlashbackId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("Memory actions for Imported Memory");
    expect(html).toContain('aria-label="Mark memory read"');
    expect(html).toContain('data-read-status-icon="unread"');
    expect(html).not.toContain(">Unread<");
    expect(html).not.toContain("Mark read");
    expect(html).toContain("Research");
    expect(html).toContain("sqlite");
    expect(html).toContain("Add tag");
    expect(html).not.toContain("data-popup-dismiss-only");
    expect(html).not.toContain("saved");
  });

  it("renders link-only status without saved label", () => {
    const html = renderToString(() =>
      createComponent(MemoryItem, {
        memory: {
          ...memory,
          extractionStatus: "link_only",
          tags: [],
        },
        selectedFlashbackId: "",
        view: "list",
        onDeleted: () => {},
      }),
    );

    expect(html).toContain("Link-only");
    expect(html).not.toContain("saved");
  });

  it("posts add-tag and add-category actions by name", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith("/tags")
            ? { tag: { id: "tag-runtime", name: "runtime" } }
            : { category: { id: "category-notes", name: "Notes" } },
        ),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    expect(
      await attachTagToMemoryByName({
        memoryId: "memory-1",
        name: "runtime",
        fetch,
      }),
    ).toEqual({ id: "tag-runtime", name: "runtime" });
    expect(
      await attachCategoryToMemoryByName({
        memoryId: "memory-1",
        name: "Notes",
        fetch,
      }),
    ).toEqual({ id: "category-notes", name: "Notes" });
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      name: "runtime",
    });
    expect(await requests[1]?.json()).toEqual({
      memoryId: "memory-1",
      name: "Notes",
    });
  });

  it("posts remove-tag actions by name", async () => {
    const requests: Request[] = [];

    expect(
      await detachTagFromMemoryByName({
        memoryId: "memory-1",
        name: "sqlite",
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          return new Response(
            JSON.stringify({ tag: { id: "tag-sqlite", name: "sqlite" } }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      }),
    ).toEqual({ id: "tag-sqlite", name: "sqlite" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/tags", "DELETE"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      name: "sqlite",
    });
  });

  it("revalidates reader data after taxonomy edits from browse cards", () => {
    expect(browseSource).toContain("revalidateAfterTaxonomyChange");
    expect(browseSource).toContain("revalidateReaderMemory(memoryId)");
  });

  it("keeps search focus indication on the rounded search surface", () => {
    expect(searchBarSource).toContain("focus-within:ring-inset");
    expect(searchBarSource).toContain("focus-within:ring-trauma-border-strong");
    expect(searchBarSource).toContain("focus-visible:shadow-none");
  });

  it("uses a dedicated search bar component wired to the URL query state", () => {
    expect(browseSource).toContain("MemorySearchBar");
    expect(searchBarSource).toContain("parseBrowseQuery(location.search)");
    expect(searchBarSource).toContain("navigate(buildBrowseHref(query(), { q: value }), { replace: true })");
  });

  it("wires vim-like keyboard operation to the memories route", () => {
    expect(browseSource).toContain("onCleanup");
    expect(browseSource).toContain('document.addEventListener("keydown", handleBrowseKeyDown)');
    expect(browseSource).toContain('document.removeEventListener("keydown", handleBrowseKeyDown)');
    expect(browseSource).toContain('event.key === "j"');
    expect(browseSource).toContain('event.key === "k"');
    expect(browseSource).toContain('event.key === "/"');
    expect(browseSource).toContain('event.key === "l"');
    expect(browseSource).toContain('event.key === "Enter"');
    expect(browseSource).toContain('data-keyboard-selected={isSelected() ? "true" : "false"}');
    expect(browseSource).toContain("focusSearchInput");
    expect(browseSource).toContain("isBrowseKeyboardSuppressed");
    expect(searchBarSource).toContain("onSearchInputMount");
    expect(searchBarSource).toContain("event.key === \"Escape\"");
    expect(searchBarSource).toContain("event.currentTarget.blur()");
  });

  it("renders memories read-state tabs instead of list and grid view controls", () => {
    expect(browseSource).toContain("MemoryReadStateTabs");
    expect(browseSource).toContain('role="tablist"');
    expect(browseSource).toContain('aria-label="Memory read status"');
    expect(browseSource).toContain("tabIndex={active() ? 0 : -1}");
    expect(browseSource).toContain("onKeyDown={(event) => handleKeyDown(event, index())}");
    expect(browseSource).toContain('event.key === "ArrowRight"');
    expect(browseSource).toContain('event.key === "Home"');
    expect(browseSource).toContain("setBrowseReadStateFilter");
    expect(browseSource).not.toContain('aria-label="View mode"');
    expect(browseSource).not.toContain('hint="List view"');
    expect(browseSource).not.toContain('hint="Grid view"');
  });

  it("does not render a header subtitle above the memories title", () => {
    expect(browseSource).not.toContain("Local memory archive");
  });

  it("posts memory deletion requests", async () => {
    const requests: Request[] = [];

    await deleteBrowseMemory({
      memoryId: "memory-1",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/memories/memory-1", "DELETE"],
    ]);
  });

  it("marks backup failsafe delete failures so the shell alert can refresh", async () => {
    let caught: unknown;
    try {
      await deleteBrowseMemory({
        memoryId: "memory-1",
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: "Backup location changed",
              backupFailsafe: {
                kind: "backup_path_drift",
              },
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      });
    } catch (error) {
      caught = error;
    }

    expect(isBackupFailsafeMemoryActionError(caught)).toBe(true);
  });
});
