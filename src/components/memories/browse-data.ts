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
  memoryId: string;
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
    q: params.get("q") ?? "",
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

  appendParam(params, "q", next.q);
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
  const search = parseBrowseSearch(query.q);

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

    if (search.readState === "both") {
      return false;
    }

    if (search.readState === "read" && !memory.read) {
      return false;
    }

    if (search.readState === "unread" && memory.read) {
      return false;
    }

    for (const filter of search.fields) {
      if (!matchesFieldFilter(memory, filter)) {
        return false;
      }
    }

    for (const term of search.freeTerms) {
      if (!getSearchableText(memory).some((value) => normalize(value).includes(term))) {
        return false;
      }
    }

    return true;
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
    .flatMap((memory) =>
      memory.flashbacks.map((flashback) => ({
        ...flashback,
        memoryId: flashback.memoryId,
      })),
    )
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

type BrowseSearchField = "title" | "url" | "tag" | "category" | "flashback";

interface BrowseFieldFilter {
  field: BrowseSearchField;
  value: string;
}

interface ParsedBrowseSearch {
  fields: BrowseFieldFilter[];
  freeTerms: string[];
  readState: "all" | "both" | "read" | "unread";
}

const fieldNames = new Set<BrowseSearchField>([
  "title",
  "url",
  "tag",
  "category",
  "flashback",
]);

function parseBrowseSearch(query: string): ParsedBrowseSearch {
  const fields: BrowseFieldFilter[] = [];
  const freeTerms: string[] = [];
  let read = false;
  let unread = false;

  for (const token of tokenizeBrowseSearch(query)) {
    if (token.kind === "field") {
      fields.push({
        field: token.field,
        value: normalize(token.value),
      });
      continue;
    }

    const normalized = normalize(token.value);
    if (normalized.length === 0) {
      continue;
    }

    if (normalized === "read") {
      read = true;
      continue;
    }

    if (normalized === "unread") {
      unread = true;
      continue;
    }

    freeTerms.push(normalized);
  }

  return {
    fields: fields.filter((field) => field.value.length > 0),
    freeTerms,
    readState: read && unread ? "both" : read ? "read" : unread ? "unread" : "all",
  };
}

type BrowseSearchToken =
  | { kind: "field"; field: BrowseSearchField; value: string }
  | { kind: "term"; value: string };

function tokenizeBrowseSearch(query: string): BrowseSearchToken[] {
  const tokens: BrowseSearchToken[] = [];
  let index = 0;

  while (index < query.length) {
    while (index < query.length && /\s/.test(query[index] ?? "")) {
      index += 1;
    }

    if (index >= query.length) {
      break;
    }

    const field = readSearchField(query, index);
    if (field !== undefined) {
      const valueStart = field.end + 1;
      if (query[valueStart] === "{") {
        const closeIndex = query.indexOf("}", valueStart + 1);
        if (closeIndex !== -1) {
          tokens.push({
            kind: "field",
            field: field.name,
            value: query.slice(valueStart + 1, closeIndex).trim(),
          });
          index = closeIndex + 1;
          continue;
        }
      }

      const valueEnd = readUntilWhitespace(query, valueStart);
      tokens.push({
        kind: "field",
        field: field.name,
        value: query.slice(valueStart, valueEnd).trim(),
      });
      index = valueEnd;
      continue;
    }

    const end = readUntilWhitespace(query, index);
    tokens.push({ kind: "term", value: query.slice(index, end) });
    index = end;
  }

  return tokens;
}

function readSearchField(
  query: string,
  start: number,
): { end: number; name: BrowseSearchField } | undefined {
  const colon = query.indexOf(":", start);
  if (colon === -1) {
    return undefined;
  }

  const whitespace = query.slice(start, colon).search(/\s/);
  if (whitespace !== -1) {
    return undefined;
  }

  const maybeField = query.slice(start, colon).toLocaleLowerCase();
  if (!fieldNames.has(maybeField as BrowseSearchField)) {
    return undefined;
  }

  return {
    end: colon,
    name: maybeField as BrowseSearchField,
  };
}

function readUntilWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && !/\s/.test(value[index] ?? "")) {
    index += 1;
  }

  return index;
}

function matchesFieldFilter(
  memory: BrowseMemory,
  filter: BrowseFieldFilter,
): boolean {
  switch (filter.field) {
    case "title":
      return normalize(memory.title).includes(filter.value);
    case "url":
      return normalize(memory.url).includes(filter.value);
    case "tag":
      return memory.tags.some((tag) => normalize(tag.name).includes(filter.value));
    case "category":
      return memory.categories.some((category) => normalize(category.name).includes(filter.value));
    case "flashback":
      return memory.flashbacks.some((flashback) =>
        [flashback.text, flashback.prefix, flashback.suffix].some((value) =>
          normalize(value).includes(filter.value),
        ),
      );
  }
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
