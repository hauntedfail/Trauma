import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  createTaxonomyRecord,
  RightRailFilters,
} from "../../src/components/shell/AppShell";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");

describe("app shell taxonomy right rail", () => {
  it("uses the full taxonomy loader instead of deriving taxonomy from visible memories", () => {
    expect(appShellSource).toContain("getBrowseTaxonomy");
    expect(appShellSource).not.toContain("getBrowseCategories(browseMemories())");
    expect(appShellSource).not.toContain("getBrowseTags(browseMemories())");
  });

  it("renders global taxonomy chips, counts, and create actions", () => {
    const html = renderToString(() =>
      createComponent(RightRailFilters, {
        activeCategory: "",
        activeFlashback: "",
        activeTag: "",
        categories: [
          {
            id: "category-empty",
            name: "Empty",
            memoryCount: 0,
            lastAssignedAt: null,
          },
        ],
        flashbacks: [],
        idPrefix: "test",
        onCreatedCategory: () => {},
        onCreatedTag: () => {},
        onSelectCategory: () => {},
        onSelectTag: () => {},
        tags: [
          {
            id: "tag-sqlite",
            name: "sqlite",
            memoryCount: 2,
            lastAssignedAt: "2026-05-14T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("New category");
    expect(html).toContain("New tag");
    expect(html).toContain("Empty");
    expect(html).toContain("sqlite");
    expect(html).toContain("rounded-full");
    expect(html).toContain("gap-x-1.5");
    expect(html).toContain(">0<");
    expect(html).toContain(">2<");
  });

  it("renders empty-state hints when no taxonomy exists", () => {
    const html = renderToString(() =>
      createComponent(RightRailFilters, {
        activeCategory: "",
        activeFlashback: "",
        activeTag: "",
        categories: [],
        flashbacks: [],
        idPrefix: "test",
        onCreatedCategory: () => {},
        onCreatedTag: () => {},
        onSelectCategory: () => {},
        onSelectTag: () => {},
        tags: [],
      }),
    );

    expect(html).toContain("No categories yet");
    expect(html).toContain("No tags yet");
  });

  it("creates taxonomy records through the correct API endpoint", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      return new Response(
        JSON.stringify({
          category: { id: "category-research", name: "Research" },
          tag: { id: "tag-sqlite", name: "sqlite" },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    };

    expect(await createTaxonomyRecord({ kind: "category", name: "Research", fetch }))
      .toEqual({ id: "category-research", name: "Research" });
    expect(await createTaxonomyRecord({ kind: "tag", name: "sqlite", fetch }))
      .toEqual({ id: "tag-sqlite", name: "sqlite" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/categories", "POST"],
      ["http://localhost/api/tags", "POST"],
    ]);
  });
});
