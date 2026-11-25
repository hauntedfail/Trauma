import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { formatConfigError, jsonResponse } from "../http/json";
import { readJsonMutationRequest } from "../http/mutation-request";
import { handleSendPsychiatristMessageRequest } from "../psychiatrist/message-route";
import { handleStartPsychiatristThreadRequest } from "../psychiatrist/thread-route";
import { loadReaderMemory } from "../reader/page-data";
import { readMemoryContent, readResolvedMemoryContent } from "../store";
import {
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from "../translation/languages";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";
import { buildPassageGroundedAskPrompt } from "./ask-prompt";
import { agentErrorResponse, extractDomain, isRecord } from "./helpers";
import {
  AGENT_ASK_ACTIONS,
  type AgentAskAction,
  type AgentAskResponse,
} from "./types";

const MAX_SELECTED_TEXT_CHARS = 2_000;
const MAX_PROMPT_CHARS = 2_000;

const ALLOWED_KEYS = new Set([
  "action",
  "selectedText",
  "sectionAnchor",
  "sectionTitle",
  "prompt",
  "langCode",
  "resumeLatest",
  "webSourcePermission",
]);

type ParsedAskPayload =
  | {
      ok: true;
      action: AgentAskAction;
      selectedText?: string;
      sectionAnchor?: string;
      sectionTitle?: string;
      prompt?: string;
      langCode?: SupportedLanguageCode;
      resumeLatest: boolean;
      webSourcePermission: "deny" | "allow_for_this_turn";
    }
  | { ok: false; error: string; status: number };

export interface AgentAskHandlerDependencies {
  config?: ResolvedTraumaConfig;
  loadReaderMemory?: typeof loadReaderMemory;
  startThread?: (event: APIEvent) => Promise<Response>;
  sendMessage?: (event: APIEvent) => Promise<Response>;
}

export function createAgentAskHandler(deps: AgentAskHandlerDependencies = {}) {
  return async function postAgentAsk(event: APIEvent): Promise<Response> {
    return handleAgentAskRequest(event, deps);
  };
}

export async function handleAgentAskRequest(
  event: APIEvent,
  deps: AgentAskHandlerDependencies = {},
): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return agentErrorResponse("memoryId must be a non-empty string", 400);
  }

  const payload = await parseAskPayload(event.request);
  if (!payload.ok) {
    return agentErrorResponse(payload.error, payload.status);
  }

  let config: ResolvedTraumaConfig;
  try {
    config = deps.config ?? loadRuntimeTraumaConfig();
  } catch (error) {
    return agentErrorResponse(formatConfigError(error), 500);
  }

  const readerResult = await (deps.loadReaderMemory ?? loadReaderMemory)(
    memoryId,
    {
      config,
      ...(payload.langCode === undefined ? {} : { langCode: payload.langCode }),
    },
  );
  if (readerResult.status !== "ready") {
    if (readerResult.status === "not_found") {
      return agentErrorResponse("memory was not found", 404);
    }
    if (readerResult.status === "content_missing") {
      return agentErrorResponse(readerResult.message, 409, {
        code: "context_unavailable",
      });
    }
    return agentErrorResponse(readerResult.message, 503, {
      code: "unavailable",
    });
  }

  const markdown = await readVariantMarkdownBestEffort({
    config,
    langCode: payload.langCode,
    memoryId,
  });

  const variantKind = payload.langCode === undefined ? "source" : "translation";
  const grounded = buildPassageGroundedAskPrompt({
    action: payload.action,
    memoryId,
    memoryTitle: readerResult.memory.title,
    domain: extractDomain(readerResult.memory.url),
    variantKind,
    ...(payload.langCode === undefined ? {} : { langCode: payload.langCode }),
    ...(payload.selectedText === undefined
      ? {}
      : { selectedText: payload.selectedText }),
    ...(payload.sectionAnchor === undefined
      ? {}
      : { sectionAnchor: payload.sectionAnchor }),
    ...(payload.sectionTitle === undefined
      ? {}
      : { sectionTitle: payload.sectionTitle }),
    ...(payload.prompt === undefined ? {} : { prompt: payload.prompt }),
    ...(markdown === undefined ? {} : { markdown }),
    toc: readerResult.rendered.toc,
  });

  const requestOrigin = new URL(event.request.url).origin;
  const threadEvent = createForwardedApiEvent({
    sourceEvent: event,
    url: `${requestOrigin}/api/memories/${encodeURIComponent(memoryId)}/psychiatrist/threads`,
    params: { memoryId },
    body: {
      ...(payload.langCode === undefined ? {} : { lang_code: payload.langCode }),
      resume_latest: payload.resumeLatest,
    },
  });

  const startThread =
    deps.startThread ??
    ((forwarded: APIEvent) =>
      handleStartPsychiatristThreadRequest(forwarded, { config }));
  const threadResponse = await startThread(threadEvent);
  if (!threadResponse.ok) {
    return threadResponse;
  }

  const threadBody = (await threadResponse.json()) as {
    thread_id?: unknown;
    variant_kind?: unknown;
    lang_code?: unknown;
  };
  if (typeof threadBody.thread_id !== "string" || threadBody.thread_id === "") {
    return agentErrorResponse("failed to initialize Psychiatrist thread", 500);
  }
  const threadId = threadBody.thread_id;

  const messageEvent = createForwardedApiEvent({
    sourceEvent: event,
    url: `${requestOrigin}/api/memories/${encodeURIComponent(memoryId)}/psychiatrist/threads/${encodeURIComponent(threadId)}/messages`,
    params: { memoryId, threadId },
    body: {
      message: grounded.prompt,
      variant_kind:
        threadBody.variant_kind === "translation" ? "translation" : "source",
      ...(typeof threadBody.lang_code === "string"
        ? { lang_code: threadBody.lang_code }
        : {}),
      web_source_permission: payload.webSourcePermission,
    },
  });

  const sendMessage =
    deps.sendMessage ??
    ((forwarded: APIEvent) =>
      handleSendPsychiatristMessageRequest(forwarded, { config }));
  const messageResponse = await sendMessage(messageEvent);
  if (!messageResponse.ok) {
    return messageResponse;
  }

  const messageBody = (await messageResponse.json()) as {
    thread_id?: unknown;
    turn_id?: unknown;
    pair_id?: unknown;
    event_url?: unknown;
  };
  if (
    typeof messageBody.turn_id !== "string" ||
    typeof messageBody.pair_id !== "string" ||
    typeof messageBody.event_url !== "string"
  ) {
    return agentErrorResponse("failed to start Psychiatrist turn", 500);
  }

  const response: AgentAskResponse = {
    threadId:
      typeof messageBody.thread_id === "string"
        ? messageBody.thread_id
        : threadId,
    turnId: messageBody.turn_id,
    pairId: messageBody.pair_id,
    eventsUrl: messageBody.event_url,
    groundedContext: grounded.groundedContext,
  };

  return jsonResponse(response, { status: 202 });
}

async function parseAskPayload(request: Request): Promise<ParsedAskPayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }

  const payload = body.payload;
  if (!isRecord(payload)) {
    return {
      ok: false,
      error: "request body must be an object",
      status: 400,
    };
  }

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        error: `unexpected field in request body: ${key}`,
        status: 400,
      };
    }
  }

  const action = payload.action;
  if (!isAgentAskAction(action)) {
    return {
      ok: false,
      error: `action must be one of: ${AGENT_ASK_ACTIONS.join(", ")}`,
      status: 400,
    };
  }

  const selectedText = readOptionalString(
    payload,
    "selectedText",
    MAX_SELECTED_TEXT_CHARS,
  );
  if (!selectedText.ok) {
    return selectedText;
  }

  const sectionAnchor = readOptionalString(payload, "sectionAnchor", 256);
  if (!sectionAnchor.ok) {
    return sectionAnchor;
  }

  const sectionTitle = readOptionalString(payload, "sectionTitle", 512);
  if (!sectionTitle.ok) {
    return sectionTitle;
  }

  const prompt = readOptionalString(payload, "prompt", MAX_PROMPT_CHARS);
  if (!prompt.ok) {
    return prompt;
  }

  if (action === "ask" && prompt.value === undefined) {
    return {
      ok: false,
      error: 'prompt is required when action is "ask"',
      status: 400,
    };
  }

  const rawLangCode = readOptionalString(payload, "langCode", 32);
  if (!rawLangCode.ok) {
    return rawLangCode;
  }
  let langCode: SupportedLanguageCode | undefined;
  if (rawLangCode.value !== undefined) {
    if (!isSupportedLanguageCode(rawLangCode.value)) {
      return {
        ok: false,
        error: "langCode must be a supported translation language",
        status: 400,
      };
    }
    langCode = rawLangCode.value;
  }

  let resumeLatest = true;
  if (Object.hasOwn(payload, "resumeLatest") && payload.resumeLatest !== undefined) {
    if (typeof payload.resumeLatest !== "boolean") {
      return {
        ok: false,
        error: "resumeLatest must be a boolean when provided",
        status: 400,
      };
    }
    resumeLatest = payload.resumeLatest;
  }

  let webSourcePermission: "deny" | "allow_for_this_turn" = "deny";
  if (
    Object.hasOwn(payload, "webSourcePermission") &&
    payload.webSourcePermission !== undefined
  ) {
    if (
      payload.webSourcePermission !== "deny" &&
      payload.webSourcePermission !== "allow_for_this_turn"
    ) {
      return {
        ok: false,
        error: 'webSourcePermission must be "deny" or "allow_for_this_turn"',
        status: 400,
      };
    }
    webSourcePermission = payload.webSourcePermission;
  }

  return {
    ok: true,
    action,
    ...(selectedText.value === undefined
      ? {}
      : { selectedText: selectedText.value }),
    ...(sectionAnchor.value === undefined
      ? {}
      : { sectionAnchor: sectionAnchor.value }),
    ...(sectionTitle.value === undefined
      ? {}
      : { sectionTitle: sectionTitle.value }),
    ...(prompt.value === undefined ? {} : { prompt: prompt.value }),
    ...(langCode === undefined ? {} : { langCode }),
    resumeLatest,
    webSourcePermission,
  };
}

function isAgentAskAction(value: unknown): value is AgentAskAction {
  return (
    typeof value === "string" &&
    (AGENT_ASK_ACTIONS as readonly string[]).includes(value)
  );
}

function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
  maxChars: number,
):
  | { ok: true; value?: string }
  | { ok: false; error: string; status: number } {
  if (
    !Object.hasOwn(payload, key) ||
    payload[key] === undefined ||
    payload[key] === null
  ) {
    return { ok: true };
  }

  const value = payload[key];
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `${key} must be a string when provided`,
      status: 400,
    };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true };
  }
  if (trimmed.length > maxChars) {
    return {
      ok: false,
      error: `${key} must be at most ${maxChars} characters`,
      status: 400,
    };
  }

  return { ok: true, value: trimmed };
}

function createForwardedApiEvent(input: {
  sourceEvent: APIEvent;
  url: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
}): APIEvent {
  const headers = new Headers({
    "content-type": "application/json",
  });
  for (const headerName of [
    "authorization",
    "origin",
    "sec-fetch-site",
    "host",
  ]) {
    const headerValue = input.sourceEvent.request.headers.get(headerName);
    if (headerValue !== null) {
      headers.set(headerName, headerValue);
    }
  }

  const request = new Request(input.url, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body),
  });

  return {
    ...input.sourceEvent,
    request,
    params: input.params,
  } as APIEvent;
}

async function readVariantMarkdownBestEffort(input: {
  config: ResolvedTraumaConfig;
  langCode?: SupportedLanguageCode;
  memoryId: string;
}): Promise<string | undefined> {
  try {
    if (input.langCode === undefined) {
      const source = await readMemoryContent({
        config: input.config,
        memoryId: input.memoryId,
      });
      return source.markdown;
    }

    const translated = await readResolvedMemoryContent(
      resolveTranslatedMemoryContentPath({
        config: input.config,
        langCode: input.langCode,
        memoryId: input.memoryId,
      }),
    );
    return translated.markdown;
  } catch {
    return undefined;
  }
}
