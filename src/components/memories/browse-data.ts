export type BrowseView = "list" | "grid";

export interface BrowseTaxonomyItem {
  id: string;
  name: string;
}

export interface BrowseHighlight {
  id: string;
  text: string;
  prefix: string;
  suffix: string;
}

export interface BrowseMemory {
  id: string;
  title: string;
  url: string;
  description: string;
  capturedAt: string;
  categories: BrowseTaxonomyItem[];
  tags: BrowseTaxonomyItem[];
  highlights: BrowseHighlight[];
}

export interface BrowseQuery {
  q: string;
  category: string;
  tag: string;
  highlight: string;
  view: BrowseView;
}

export const browseMemories: BrowseMemory[] = [
  {
    id: "memory-foundation",
    title: "Reader Mode Notes",
    url: "https://example.com/reader-mode",
    description: "SolidStart route data and shell architecture notes for the canonical reader.",
    capturedAt: "2026-05-09",
    categories: [{ id: "research", name: "Research" }],
    tags: [
      { id: "solidstart", name: "solidstart" },
      { id: "reader", name: "reader" },
    ],
    highlights: [
      {
        id: "h-foundation",
        text: "highlight-aware results",
        prefix: "Search query can be wired to",
        suffix: "through repository fixtures.",
      },
    ],
  },
  {
    id: "memory-ops",
    title: "Local Hosting Checklist",
    url: "https://example.com/local-hosting",
    description: "Single Bun process and persistent disk assumptions for self-hosted operation.",
    capturedAt: "2026-05-08",
    categories: [{ id: "operations", name: "Operations" }],
    tags: [
      { id: "sqlite", name: "sqlite" },
      { id: "backup", name: "backup" },
    ],
    highlights: [
      {
        id: "h-ops",
        text: "persistent disk assumptions",
        prefix: "The app keeps deployment simple with",
        suffix: "and a markdown store.",
      },
    ],
  },
  {
    id: "memory-design",
    title: "Browse Shell Sketch",
    url: "https://example.com/browse-shell",
    description: "X-like layout notes for navigation, filters, and dense memory browsing.",
    capturedAt: "2026-05-07",
    categories: [{ id: "product", name: "Product" }],
    tags: [
      { id: "shell", name: "shell" },
      { id: "filters", name: "filters" },
    ],
    highlights: [
      {
        id: "h-shell",
        text: "right filter panel updates URL state",
        prefix: "The canonical browse workflow requires that the",
        suffix: "without page-local navigation.",
      },
    ],
  },
];

export const defaultBrowseQuery: BrowseQuery = {
  q: "",
  category: "",
  tag: "",
  highlight: "",
  view: "list",
};

export function parseBrowseQuery(search: string): BrowseQuery {
  const params = new URLSearchParams(search);
  const view = params.get("view") === "grid" ? "grid" : "list";

  return {
    q: params.get("q")?.trim() ?? "",
    category: params.get("category") ?? "",
    tag: params.get("tag") ?? "",
    highlight: params.get("highlight") ?? "",
    view,
  };
}

export function buildBrowseHref(query: BrowseQuery, patch: Partial<BrowseQuery>): string {
  const next: BrowseQuery = {
    ...query,
    ...patch,
  };
  const params = new URLSearchParams();

  appendParam(params, "q", next.q.trim());
  appendParam(params, "category", next.category);
  appendParam(params, "tag", next.tag);
  appendParam(params, "highlight", next.highlight);

  if (next.view === "grid") {
    params.set("view", "grid");
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `/memories?${queryString}` : "/memories";
}

export function filterBrowseMemories(memories: BrowseMemory[], query: BrowseQuery): BrowseMemory[] {
  const normalizedSearch = normalize(query.q);

  return memories.filter((memory) => {
    if (query.category.length > 0 && !memory.categories.some((category) => category.id === query.category)) {
      return false;
    }

    if (query.tag.length > 0 && !memory.tags.some((tag) => tag.id === query.tag)) {
      return false;
    }

    if (query.highlight.length > 0 && !memory.highlights.some((highlight) => highlight.id === query.highlight)) {
      return false;
    }

    if (normalizedSearch.length === 0) {
      return true;
    }

    return getSearchableText(memory).some((value) => normalize(value).includes(normalizedSearch));
  });
}

export function getBrowseCategories(memories: BrowseMemory[]): BrowseTaxonomyItem[] {
  return getUniqueTaxonomyItems(memories.flatMap((memory) => memory.categories));
}

export function getBrowseTags(memories: BrowseMemory[]): BrowseTaxonomyItem[] {
  return getUniqueTaxonomyItems(memories.flatMap((memory) => memory.tags));
}

export function getRecentHighlights(memories: BrowseMemory[]): BrowseHighlight[] {
  return memories.flatMap((memory) => memory.highlights).slice(0, 5);
}

function appendParam(params: URLSearchParams, key: string, value: string): void {
  if (value.length > 0) {
    params.set(key, value);
  }
}

function getSearchableText(memory: BrowseMemory): string[] {
  return [
    memory.title,
    memory.url,
    memory.description,
    ...memory.categories.map((category) => category.name),
    ...memory.tags.map((tag) => tag.name),
    ...memory.highlights.flatMap((highlight) => [highlight.text, highlight.prefix, highlight.suffix]),
  ];
}

function getUniqueTaxonomyItems(items: BrowseTaxonomyItem[]): BrowseTaxonomyItem[] {
  const unique = new Map<string, BrowseTaxonomyItem>();

  for (const item of items) {
    if (!unique.has(item.id)) {
      unique.set(item.id, item);
    }
  }

  return [...unique.values()];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
