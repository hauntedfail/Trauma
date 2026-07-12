import type {
  PsychiatristThreadResponse,
  PsychiatristTurnStartedResponse,
  PsychiatristWebSourcePermission,
} from "./psychiatrist-types";

type BrowserFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface PsychiatristRequestScopeInput {
  langCode?: string | null;
  memoryId: string;
  threadId: string;
  variantKind: "source" | "translation";
}

export class PsychiatristRequestError extends Error {
  action: string;
  code: string;
  responseStatus: number;

  constructor(input: {
    action: string;
    code: string;
    message: string;
    responseStatus: number;
  }) {
    super(input.message);
    this.name = "PsychiatristRequestError";
    this.action = input.action;
    this.code = input.code;
    this.responseStatus = input.responseStatus;
  }
}

export function getPsychiatristErrorMessage(error: unknown): string {
  if (!(error instanceof PsychiatristRequestError)) {
    return "Psychiatrist request failed.";
  }
  switch (error.code) {
    case "auth_required":
      return "Set up Codex auth before using Psychiatrist.";
    case "setup_required":
      return "Codex app-server must be available before using Psychiatrist.";
    case "runtime_isolation_required":
      return "Configure the required isolated Codex runtime before using Psychiatrist.";
    case "app_server_unavailable":
      return "Start the Codex app-server, then retry Psychiatrist.";
    case "usage_limit":
    case "timeout":
    case "stream_disconnected":
      return "Psychiatrist could not finish. Retry when ready.";
    case "context_overflow":
      return "This memory is too large for the current assistant context.";
    case "network_permission_required":
      return "Allow web search/source lookup for this answer to continue.";
    case "turn_stopped":
      return "Psychiatrist turn was stopped.";
    case "turn_not_ready":
      return "Psychiatrist turn is still starting. Retry Stop after the turn is ready.";
    case "regenerate_unavailable":
      return "This response cannot be regenerated.";
    case "thread_not_found":
      return "Open the reader again to start a new Psychiatrist thread.";
    default:
      return "Psychiatrist request failed.";
  }
}

export async function createPsychiatristThread(input: {
  fetch?: BrowserFetch;
  langCode?: string;
  memoryId: string;
  resumeLatest?: boolean;
}): Promise<PsychiatristThreadResponse> {
  const body: Record<string, unknown> = {
    resume_latest: input.resumeLatest ?? true,
  };
  if (input.langCode !== undefined) {
    body.lang_code = input.langCode;
  }
  return requestJson<PsychiatristThreadResponse>({
    body,
    fetch: input.fetch,
    method: "POST",
    path: `/api/memories/${encodeURIComponent(input.memoryId)}/psychiatrist/threads`,
  });
}

export async function sendPsychiatristMessage(input: {
  fetch?: BrowserFetch;
  langCode?: string | null;
  memoryId: string;
  message: string;
  threadId: string;
  variantKind: "source" | "translation";
  webSourcePermission?: PsychiatristWebSourcePermission;
}): Promise<PsychiatristTurnStartedResponse> {
  const body: Record<string, unknown> = {
    message: input.message,
    variant_kind: input.variantKind,
    web_source_permission: input.webSourcePermission ?? "deny",
  };
  if (input.langCode !== undefined && input.langCode !== null) {
    body.lang_code = input.langCode;
  }
  return requestJson<PsychiatristTurnStartedResponse>({
    body,
    fetch: input.fetch,
    method: "POST",
    path: scopedThreadPath(input) + "/messages",
  });
}

export async function cancelPsychiatristTurn(input: PsychiatristRequestScopeInput & {
  fetch?: BrowserFetch;
  pairId: string;
  turnId: string;
}): Promise<void> {
  await requestJson<unknown>({
    body: {
      lang_code: input.langCode ?? null,
      memory_id: input.memoryId,
      pair_id: input.pairId,
      thread_id: input.threadId,
      variant_kind: input.variantKind,
    },
    fetch: input.fetch,
    method: "POST",
    path: scopedThreadPath(input) +
      `/turns/${encodeURIComponent(input.turnId)}/cancel`,
  });
}

export async function regeneratePsychiatristResponse(input: PsychiatristRequestScopeInput & {
  fetch?: BrowserFetch;
  pairId: string;
  webSourcePermission?: PsychiatristWebSourcePermission;
}): Promise<PsychiatristTurnStartedResponse> {
  return requestJson<PsychiatristTurnStartedResponse>({
    body: {
      lang_code: input.langCode ?? null,
      memory_id: input.memoryId,
      thread_id: input.threadId,
      variant_kind: input.variantKind,
      web_source_permission: input.webSourcePermission ?? "deny",
    },
    fetch: input.fetch,
    method: "POST",
    path: scopedThreadPath(input) +
      `/pairs/${encodeURIComponent(input.pairId)}/regenerate`,
  });
}

function scopedThreadPath(input: PsychiatristRequestScopeInput): string {
  return `/api/memories/${encodeURIComponent(input.memoryId)}` +
    `/psychiatrist/threads/${encodeURIComponent(input.threadId)}`;
}

async function requestJson<T>(input: {
  body?: unknown;
  fetch?: BrowserFetch;
  method: string;
  path: string;
}): Promise<T> {
  const fetcher = input.fetch ?? fetch;
  const response = await fetcher(input.path, {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: input.body === undefined ? undefined : { "content-type": "application/json" },
    method: input.method,
  });
  if (!response.ok) {
    throw await readRequestError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return await response.json() as T;
}

async function readRequestError(response: Response): Promise<PsychiatristRequestError> {
  try {
    const value = await response.json() as {
      action?: unknown;
      code?: unknown;
      message?: unknown;
    };
    return new PsychiatristRequestError({
      action: typeof value.action === "string" ? value.action : "retry",
      code: typeof value.code === "string" ? value.code : "request_failed",
      message: typeof value.message === "string"
        ? value.message
        : "Psychiatrist request failed.",
      responseStatus: response.status,
    });
  } catch {
    return new PsychiatristRequestError({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist request failed.",
      responseStatus: response.status,
    });
  }
}
