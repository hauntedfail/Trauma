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
  createdAt: string;
}

export interface BrowseReaderHighlight extends BrowseHighlight {
  anchorId: string;
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
    category: params.get("category")?.trim() ?? "",
    tag: params.get("tag")?.trim() ?? "",
    highlight: params.get("highlight")?.trim() ?? "",
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
  appendParam(params, "category", next.category.trim());
  appendParam(params, "tag", next.tag.trim());
  appendParam(params, "highlight", next.highlight.trim());

  if (next.view === "grid") {
    params.set("view", "grid");
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `/memories?${queryString}` : "/memories";
}

export function buildHighlightBrowseHref(highlightId: string): string {
  return buildBrowseHref(defaultBrowseQuery, { highlight: highlightId });
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
  return memories
    .flatMap((memory) => memory.highlights)
    .toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 5);
}

export function getMemoryDisplayHighlight(memory: BrowseMemory, activeHighlightId: string): BrowseHighlight | undefined {
  if (activeHighlightId.length > 0) {
    return memory.highlights.find((highlight) => highlight.id === activeHighlightId) ?? memory.highlights[0];
  }

  return memory.highlights[0];
}

export function getMemoryReaderHighlights(memory: BrowseMemory): BrowseReaderHighlight[] {
  return memory.highlights.map((highlight) => ({
    ...highlight,
    anchorId: highlight.id,
  }));
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
