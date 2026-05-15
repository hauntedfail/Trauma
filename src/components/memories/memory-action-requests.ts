import type { BrowseTaxonomyItem } from "./browse-data";

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function attachTagToMemoryByName(input: {
  memoryId: string;
  name: string;
  fetch?: FetchFunction;
}): Promise<BrowseTaxonomyItem> {
  const body = await postJson({
    url: "/api/memories/tags",
    body: {
      memoryId: input.memoryId,
      name: input.name,
    },
    fetch: input.fetch,
  });
  return readTaxonomyResponse(body, "tag");
}

export async function attachCategoryToMemoryByName(input: {
  memoryId: string;
  name: string;
  fetch?: FetchFunction;
}): Promise<BrowseTaxonomyItem> {
  const body = await postJson({
    url: "/api/memories/categories",
    body: {
      memoryId: input.memoryId,
      name: input.name,
    },
    fetch: input.fetch,
  });
  return readTaxonomyResponse(body, "category");
}

export async function deleteMemoryById(input: {
  memoryId: string;
  fetch?: FetchFunction;
}): Promise<void> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(`/api/memories/${input.memoryId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("failed to delete memory");
  }
}

async function postJson(input: {
  url: string;
  body: unknown;
  fetch?: FetchFunction;
}): Promise<unknown> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body),
  });
  if (!response.ok) {
    throw new Error("memory action request failed");
  }

  return response.json() as Promise<unknown>;
}

function readTaxonomyResponse(
  body: unknown,
  key: "tag" | "category",
): BrowseTaxonomyItem {
  if (!isRecord(body)) {
    throw new Error("memory action response was malformed");
  }

  const item = body[key];
  if (
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.name === "string"
  ) {
    return {
      id: item.id,
      name: item.name,
    };
  }

  throw new Error("memory action response was malformed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
