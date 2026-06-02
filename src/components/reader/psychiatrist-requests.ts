import type {
  PsychiatristThreadResponse,
  PsychiatristTurnStartedResponse,
  PsychiatristWebSourcePermission,
} from "./psychiatrist-types";

type BrowserFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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
    throw new Error(await readErrorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return await response.json() as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const value = await response.json() as { message?: unknown };
    return typeof value.message === "string"
      ? value.message
      : "Psychiatrist request failed.";
  } catch {
    return "Psychiatrist request failed.";
  }
}
