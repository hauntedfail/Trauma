import type {
  PsychiatristActiveTurnResponse,
  PsychiatristCancelResult,
  PsychiatristThreadPairResponse,
  PsychiatristThreadResponse,
  PsychiatristTurnStartedResponse,
  PsychiatristWebSourcePermission,
} from "./psychiatrist-types";
import {
  isNonEmptyString,
  isPsychiatristSourceCitation,
  isRecord,
} from "./psychiatrist-runtime-validation";

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

interface PsychiatristJsonRequestInput {
  body?: unknown;
  fetch?: BrowserFetch;
  method: string;
  path: string;
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
    case "event_limit_exceeded":
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
  const response = await requestJson({
    body,
    fetch: input.fetch,
    invalidResponseMessage: "Psychiatrist thread response was invalid.",
    method: "POST",
    path: `/api/memories/${encodeURIComponent(input.memoryId)}/psychiatrist/threads`,
  });
  const expectedLangCode = input.langCode ?? null;
  const expectedVariantKind = input.langCode === undefined ? "source" : "translation";
  if (!isPsychiatristThreadResponse(response.value) ||
    response.value.memory_id !== input.memoryId ||
    response.value.lang_code !== expectedLangCode ||
    response.value.variant_kind !== expectedVariantKind
  ) {
    throw invalidPsychiatristResponse(
      "Psychiatrist thread response was invalid.",
      response.status,
    );
  }
  return response.value;
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
  const response = await requestJson({
    body,
    fetch: input.fetch,
    invalidResponseMessage: "Psychiatrist message response was invalid.",
    method: "POST",
    path: scopedThreadPath(input) + "/messages",
  });
  if (!isPsychiatristTurnStartedResponse(response.value) ||
    response.value.thread_id !== input.threadId
  ) {
    throw invalidPsychiatristResponse(
      "Psychiatrist message response was invalid.",
      response.status,
    );
  }
  return response.value;
}

export async function cancelPsychiatristTurn(input: PsychiatristRequestScopeInput & {
  fetch?: BrowserFetch;
  pairId: string;
  turnId: string;
}): Promise<PsychiatristCancelResult> {
  const value = await requestCancelJson({
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
  if (!isPsychiatristCancelResult(value) || value.turn_id !== input.turnId) {
    throw new PsychiatristRequestError({
      action: "retry",
      code: "request_failed",
      message: "Psychiatrist cancel response was invalid.",
      responseStatus: 200,
    });
  }
  return value;
}

export async function regeneratePsychiatristResponse(input: PsychiatristRequestScopeInput & {
  fetch?: BrowserFetch;
  pairId: string;
  webSourcePermission?: PsychiatristWebSourcePermission;
}): Promise<PsychiatristTurnStartedResponse> {
  const response = await requestJson({
    body: {
      lang_code: input.langCode ?? null,
      memory_id: input.memoryId,
      thread_id: input.threadId,
      variant_kind: input.variantKind,
      web_source_permission: input.webSourcePermission ?? "deny",
    },
    fetch: input.fetch,
    invalidResponseMessage: "Psychiatrist regenerate response was invalid.",
    method: "POST",
    path: scopedThreadPath(input) +
      `/pairs/${encodeURIComponent(input.pairId)}/regenerate`,
  });
  if (!isPsychiatristTurnStartedResponse(response.value) ||
    response.value.thread_id !== input.threadId ||
    response.value.pair_id !== input.pairId
  ) {
    throw invalidPsychiatristResponse(
      "Psychiatrist regenerate response was invalid.",
      response.status,
    );
  }
  return response.value;
}

function scopedThreadPath(input: PsychiatristRequestScopeInput): string {
  return `/api/memories/${encodeURIComponent(input.memoryId)}` +
    `/psychiatrist/threads/${encodeURIComponent(input.threadId)}`;
}

async function requestJson(input: PsychiatristJsonRequestInput & {
  invalidResponseMessage: string;
}): Promise<{ status: number; value: unknown }> {
  const response = await requestSuccessfulResponse(input);
  if (response.status === 204) {
    throw invalidPsychiatristResponse(input.invalidResponseMessage, response.status);
  }
  try {
    return {
      status: response.status,
      value: await response.json() as unknown,
    };
  } catch {
    throw invalidPsychiatristResponse(input.invalidResponseMessage, response.status);
  }
}

async function requestCancelJson(
  input: PsychiatristJsonRequestInput,
): Promise<unknown> {
  const response = await requestSuccessfulResponse(input);
  if (response.status === 204) {
    return undefined;
  }
  return await response.json() as unknown;
}

async function requestSuccessfulResponse(
  input: PsychiatristJsonRequestInput,
): Promise<Response> {
  const fetcher = input.fetch ?? fetch;
  const response = await fetcher(input.path, {
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: input.body === undefined ? undefined : { "content-type": "application/json" },
    method: input.method,
  });
  if (!response.ok) {
    throw await readRequestError(response);
  }
  return response;
}

function invalidPsychiatristResponse(
  message: string,
  responseStatus: number,
): PsychiatristRequestError {
  return new PsychiatristRequestError({
    action: "retry",
    code: "request_failed",
    message,
    responseStatus,
  });
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

function isPsychiatristCancelResult(value: unknown): value is PsychiatristCancelResult {
  if (!isRecord(value) ||
    (value.status !== "canceled" && value.status !== "completed" && value.status !== "failed") ||
    typeof value.turn_id !== "string" ||
    value.turn_id === ""
  ) {
    return false;
  }
  if (value.warning === undefined) {
    return true;
  }
  return isRecord(value.warning) &&
    typeof value.warning.code === "string" &&
    typeof value.warning.message === "string";
}

function isPsychiatristThreadResponse(value: unknown): value is PsychiatristThreadResponse {
  return isRecord(value) &&
    (value.active_turn === null || isPsychiatristActiveTurnResponse(value.active_turn)) &&
    isNonEmptyString(value.content_hash) &&
    (value.lang_code === null || isNonEmptyString(value.lang_code)) &&
    isNonEmptyString(value.memory_id) &&
    Array.isArray(value.pairs) &&
    value.pairs.every(isPsychiatristThreadPairResponse) &&
    isPsychiatristThreadStatus(value.status) &&
    isNonEmptyString(value.thread_id) &&
    (value.variant_kind === "source" || value.variant_kind === "translation");
}

function isPsychiatristActiveTurnResponse(
  value: unknown,
): value is PsychiatristActiveTurnResponse {
  return isRecord(value) &&
    isNonEmptyString(value.event_url) &&
    isNonEmptyString(value.pair_id) &&
    value.status === "running" &&
    isNonEmptyString(value.turn_id);
}

function isPsychiatristThreadPairResponse(
  value: unknown,
): value is PsychiatristThreadPairResponse {
  return isRecord(value) &&
    (value.assistant_response === undefined ||
      isPsychiatristAssistantResponse(value.assistant_response)) &&
    isNonEmptyString(value.pair_id) &&
    (value.retry_action === undefined || value.retry_action === "allow_web_sources") &&
    (value.retry_mode === undefined ||
      value.retry_mode === "first_answer" ||
      value.retry_mode === "regenerate") &&
    (value.retry_turn_id === undefined || isNonEmptyString(value.retry_turn_id)) &&
    isPsychiatristPairStatus(value.status) &&
    isNonEmptyString(value.turn_id) &&
    isPsychiatristUserPrompt(value.user_prompt);
}

function isPsychiatristAssistantResponse(value: unknown): boolean {
  return isRecord(value) &&
    isNonEmptyString(value.completed_at) &&
    typeof value.content === "string" &&
    Array.isArray(value.source_citations) &&
    value.source_citations.every(isPsychiatristSourceCitation);
}

function isPsychiatristUserPrompt(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.content === "string" &&
    isNonEmptyString(value.created_at);
}

function isPsychiatristTurnStartedResponse(
  value: unknown,
): value is PsychiatristTurnStartedResponse {
  return isRecord(value) &&
    isNonEmptyString(value.event_url) &&
    isNonEmptyString(value.pair_id) &&
    isNonEmptyString(value.replay_url) &&
    value.status === "started" &&
    isNonEmptyString(value.thread_id) &&
    isNonEmptyString(value.turn_id);
}

function isPsychiatristThreadStatus(value: unknown): boolean {
  return value === "ready" ||
    value === "running" ||
    value === "stale" ||
    value === "failed" ||
    value === "canceled";
}

function isPsychiatristPairStatus(value: unknown): boolean {
  return value === "pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled" ||
    value === "stale";
}
