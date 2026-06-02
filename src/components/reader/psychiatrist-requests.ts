import type {
  PsychiatristThreadResponse,
  PsychiatristTurnStartedResponse,
  PsychiatristWebSourcePermission,
} from "./psychiatrist-types";

type BrowserFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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
  clientMessageId: string;
  fetch?: BrowserFetch;
  message: string;
  threadId: string;
  webSourcePermission?: PsychiatristWebSourcePermission;
}): Promise<PsychiatristTurnStartedResponse> {
  return requestJson<PsychiatristTurnStartedResponse>({
    body: {
      client_message_id: input.clientMessageId,
      message: input.message,
      web_source_permission: input.webSourcePermission ?? "deny",
    },
    fetch: input.fetch,
    method: "POST",
    path: `/api/psychiatrist-threads/${encodeURIComponent(input.threadId)}/messages`,
  });
}

export async function cancelPsychiatristTurn(input: {
  fetch?: BrowserFetch;
  turnId: string;
}): Promise<void> {
  await requestJson<unknown>({
    fetch: input.fetch,
    method: "POST",
    path: `/api/psychiatrist-turns/${encodeURIComponent(input.turnId)}/cancel`,
  });
}

export async function regeneratePsychiatristResponse(input: {
  fetch?: BrowserFetch;
  pairId: string;
  webSourcePermission?: PsychiatristWebSourcePermission;
}): Promise<PsychiatristTurnStartedResponse> {
  return requestJson<PsychiatristTurnStartedResponse>({
    body: {
      web_source_permission: input.webSourcePermission ?? "deny",
    },
    fetch: input.fetch,
    method: "POST",
    path: `/api/psychiatrist-pairs/${encodeURIComponent(input.pairId)}/regenerate`,
  });
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
