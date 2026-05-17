import type { BrowseTaxonomyItem } from "./browse-data";

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class MemoryActionRequestError extends Error {
  readonly backupFailsafe: boolean;

  constructor(message: string, options: { backupFailsafe?: boolean } = {}) {
    super(message);
    this.name = "MemoryActionRequestError";
    this.backupFailsafe = options.backupFailsafe === true;
  }
}

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
    const body = await readJsonRecord(response);
    throw new MemoryActionRequestError(
      readErrorMessage(body) ?? "failed to delete memory",
      { backupFailsafe: hasBackupFailsafe(body) },
    );
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
    const body = await readJsonRecord(response);
    throw new MemoryActionRequestError(
      readErrorMessage(body) ?? "memory action request failed",
      { backupFailsafe: hasBackupFailsafe(body) },
    );
  }

  return response.json() as Promise<unknown>;
}

export function isBackupFailsafeMemoryActionError(error: unknown): boolean {
  return error instanceof MemoryActionRequestError && error.backupFailsafe;
}

async function readJsonRecord(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readErrorMessage(payload: Record<string, unknown> | null): string | null {
  const error = payload?.error;
  return typeof error === "string" && error.trim() !== "" ? error : null;
}

function hasBackupFailsafe(payload: Record<string, unknown> | null): boolean {
  return isRecord(payload?.backupFailsafe);
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
