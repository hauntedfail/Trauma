import type { BrowseTaxonomyItem, MemoryTriageState } from "./browse-data";

export const TODAY_CAP_REACHED_MESSAGE =
  "Today is full. Finish or return one first.";

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MemoryActionRequestErrorOptions {
  backupFailsafe?: boolean;
  code?: string;
  status?: number;
  todayCount?: number;
  todayCap?: number;
}

export class MemoryActionRequestError extends Error {
  readonly backupFailsafe: boolean;
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly todayCount: number | undefined;
  readonly todayCap: number | undefined;

  constructor(
    message: string,
    options: MemoryActionRequestErrorOptions = {},
  ) {
    super(message);
    this.name = "MemoryActionRequestError";
    this.backupFailsafe = options.backupFailsafe === true;
    this.code = options.code;
    this.status = options.status;
    this.todayCount = options.todayCount;
    this.todayCap = options.todayCap;
  }
}

export interface SetMemoryTriageStateInput {
  memoryId: string;
  triageState: MemoryTriageState;
  todayCap?: number | null;
  fetch?: FetchFunction;
}

export interface SetMemoryTriageStateResult {
  memoryId: string;
  triageState: MemoryTriageState;
  triageChangedAt: string;
  changed: boolean;
}

export async function setMemoryTriageState(
  input: SetMemoryTriageStateInput,
): Promise<SetMemoryTriageStateResult> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(
    `/api/memories/${encodeURIComponent(input.memoryId)}/triage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        triage_state: input.triageState,
        ...(input.todayCap !== undefined ? { todayCap: input.todayCap } : {}),
      }),
    },
  );

  const body = await readJsonRecord(response);
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : undefined;
    const todayCount =
      typeof body?.todayCount === "number" ? body.todayCount : undefined;
    const todayCap =
      typeof body?.todayCap === "number" ? body.todayCap : undefined;
    throw new MemoryActionRequestError(
      readErrorMessage(body) ??
        (code === "today_cap_reached"
          ? TODAY_CAP_REACHED_MESSAGE
          : "Could not update lane. Please try again."),
      {
        backupFailsafe: hasBackupFailsafe(body),
        code,
        status: response.status,
        todayCount,
        todayCap,
      },
    );
  }

  const triageState =
    typeof body?.triageState === "string"
      ? (body.triageState as MemoryTriageState)
      : input.triageState;
  const triageChangedAt =
    typeof body?.triageChangedAt === "string"
      ? body.triageChangedAt
      : new Date().toISOString();
  const changed = typeof body?.changed === "boolean" ? body.changed : true;

  return {
    memoryId: typeof body?.memoryId === "string" ? body.memoryId : input.memoryId,
    triageState,
    triageChangedAt,
    changed,
  };
}

export function isTodayCapReachedError(error: unknown): boolean {
  return (
    error instanceof MemoryActionRequestError &&
    (error.code === "today_cap_reached" || error.status === 409)
  );
}

export async function attachTagToMemoryByName(input: {
  memoryId: string;
  name: string;
  fetch?: FetchFunction;
}): Promise<BrowseTaxonomyItem> {
  const body = await requestJson({
    method: "POST",
    url: "/api/memories/tags",
    body: {
      memoryId: input.memoryId,
      name: input.name,
    },
    fetch: input.fetch,
  });
  return readTaxonomyResponse(body, "tag");
}

export async function detachTagFromMemoryByName(input: {
  memoryId: string;
  name: string;
  fetch?: FetchFunction;
}): Promise<BrowseTaxonomyItem> {
  const body = await requestJson({
    method: "DELETE",
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
  const body = await requestJson({
    method: "POST",
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

async function requestJson(input: {
  method: "DELETE" | "POST";
  url: string;
  body: unknown;
  fetch?: FetchFunction;
}): Promise<unknown> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(input.url, {
    method: input.method,
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
