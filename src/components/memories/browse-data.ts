import type { ExtractionStatus } from "../../server/memory-status";

export type BrowseView = "list" | "grid";

export interface BrowseTaxonomyItem {
  id: string;
  name: string;
}

export interface BrowseTaxonomySummaryItem extends BrowseTaxonomyItem {
  memoryCount: number;
  lastAssignedAt: string | null;
}

export interface BrowseTaxonomySummary {
  categories: BrowseTaxonomySummaryItem[];
  tags: BrowseTaxonomySummaryItem[];
}

export interface BrowseFlashback {
  id: string;
  text: string;
  prefix: string;
  suffix: string;
  createdAt: string;
}

export interface BrowseReaderFlashback extends BrowseFlashback {
  anchorId: string;
}

export interface BrowseMemory {
  id: string;
  title: string;
  url: string;
  description: string;
  capturedAt: string;
  read: boolean;
  extractionStatus: ExtractionStatus;
  categories: BrowseTaxonomyItem[];
  tags: BrowseTaxonomyItem[];
  flashbacks: BrowseFlashback[];
}

export interface BrowseQuery {
  q: string;
  category: string;
  tag: string;
  flashback: string;
  view: BrowseView;
}

export const defaultBrowseQuery: BrowseQuery = {
  q: "",
  category: "",
  tag: "",
  flashback: "",
  view: "list",
};

export function parseBrowseQuery(search: string): BrowseQuery {
  const params = new URLSearchParams(search);
  const view = params.get("view") === "grid" ? "grid" : "list";

  return {
    q: params.get("q")?.trim() ?? "",
    category: params.get("category")?.trim() ?? "",
    tag: params.get("tag")?.trim() ?? "",
    flashback:
      params.get("flashback")?.trim() ||
      params.get("highlight")?.trim() ||
      "",
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
  appendParam(params, "flashback", next.flashback.trim());

  if (next.view === "grid") {
    params.set("view", "grid");
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `/memories?${queryString}` : "/memories";
}

export function buildFlashbackBrowseHref(flashbackId: string): string {
  return buildBrowseHref(defaultBrowseQuery, { flashback: flashbackId });
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

    if (query.flashback.length > 0 && !memory.flashbacks.some((flashback) => flashback.id === query.flashback)) {
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

export function getRecentFlashbacks(memories: BrowseMemory[]): BrowseFlashback[] {
  return memories
    .flatMap((memory) => memory.flashbacks)
    .toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 5);
}

export function getMemoryDisplayFlashback(memory: BrowseMemory, activeFlashbackId: string): BrowseFlashback | undefined {
  if (activeFlashbackId.length > 0) {
    return memory.flashbacks.find((flashback) => flashback.id === activeFlashbackId) ?? memory.flashbacks[0];
  }

  return memory.flashbacks[0];
}

export function getMemoryReaderFlashbacks(memory: BrowseMemory): BrowseReaderFlashback[] {
  return memory.flashbacks.map((flashback) => ({
    ...flashback,
    anchorId: flashback.id,
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
    ...memory.flashbacks.flatMap((flashback) => [flashback.text, flashback.prefix, flashback.suffix]),
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
