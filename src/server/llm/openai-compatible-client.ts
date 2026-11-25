import { randomUUID } from "node:crypto";

import type { CodexAuthClient } from "../settings/codex-auth";
import {
  CodexAppServerError,
  type CodexAppServerEvent,
  type CodexAppServerEventHandler,
  type CodexAuthCheckOptions,
  type CodexAuthEvent,
  type CodexAuthStatus,
  type CodexConversationClient,
  type CodexConversationTurnInput,
  type CodexConversationTurnResult,
  type CodexDeviceCodeLogin,
  type CodexLogoutResult,
  type CodexModelCatalog,
  type CodexModelInfo,
  type TranslateChunkInput,
  type TranslationClient,
} from "../translation/codex-app-server";
import {
  CODEX_REASONING_EFFORTS,
  type RawCodexChunkOutput,
} from "../translation/types";

export const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 120_000;

export type OpenAICompatibleFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAICompatibleClientOptions {
  apiKey?: string;
  baseUrl: string;
  defaultModel?: string;
  fetch?: OpenAICompatibleFetch;
  requestTimeoutMs?: number;
}

interface ActiveTurnControl {
  controller: AbortController;
  reason?: "backpressure" | "canceled" | "timeout";
  threadId: string;
}

export function normalizeOpenAIBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new CodexAppServerError(
      "setup_required",
      "TRAUMA_OPENAI_BASE_URL must be set when TRAUMA_LLM_PROVIDER=openai_compatible.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CodexAppServerError(
      "setup_required",
      "TRAUMA_OPENAI_BASE_URL must be a valid http(s) URL.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CodexAppServerError(
      "setup_required",
      "TRAUMA_OPENAI_BASE_URL must use http or https.",
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new CodexAppServerError(
      "setup_required",
      "TRAUMA_OPENAI_BASE_URL must not include embedded credentials.",
    );
  }
  return parsed.href.replace(/\/+$/, "");
}

export function redactOpenAISecrets(value: string, apiKey?: string): string {
  let redacted = value;
  const trimmedKey = apiKey?.trim();
  if (trimmedKey !== undefined && trimmedKey !== "") {
    redacted = redacted.split(trimmedKey).join("[REDACTED]");
  }
  redacted = redacted.replace(
    /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
    "Bearer [REDACTED]",
  );
  redacted = redacted.replace(/\bsk-[A-Za-z0-9._\-]{8,}\b/g, "[REDACTED]");
  redacted = redacted.replace(
    /(api[_-]?key\s*[:=]\s*["']?)[^\s"',}]+/gi,
    "$1[REDACTED]",
  );
  return redacted;
}

export class OpenAICompatibleClient
  implements TranslationClient, CodexConversationClient, CodexAuthClient
{
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private cachedDefaultModel: string | undefined;
  private readonly defaultModel: string | undefined;
  private readonly fetchImpl: OpenAICompatibleFetch;
  private readonly requestTimeoutMs: number;
  private responseFormatMode: "json_object" | "prompt_only" = "json_object";
  private readonly activeTurns = new Map<string, ActiveTurnControl>();

  constructor(options: OpenAICompatibleClientOptions) {
    this.baseUrl = normalizeOpenAIBaseUrl(options.baseUrl);
    const trimmedKey = options.apiKey?.trim();
    this.apiKey = trimmedKey === "" ? undefined : trimmedKey;
    const trimmedModel = options.defaultModel?.trim();
    this.defaultModel = trimmedModel === "" ? undefined : trimmedModel;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMs =
      options.requestTimeoutMs !== undefined &&
      Number.isSafeInteger(options.requestTimeoutMs) &&
      options.requestTimeoutMs > 0
        ? options.requestTimeoutMs
        : DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
  }

  async probe(): Promise<void> {
    await this.listModels();
  }

  async checkAuth(_input?: CodexAuthCheckOptions): Promise<CodexAuthStatus> {
    try {
      await this.probe();
      return { status: "enabled" };
    } catch (error) {
      if (error instanceof CodexAppServerError) {
        if (error.code === "auth_required") {
          return { status: "setup_required", reason: "auth_required" };
        }
        if (error.code === "setup_required") {
          return { status: "setup_required", reason: "openai_compatible_setup_required" };
        }
        if (error.code === "app_server_unavailable" || error.code === "timeout") {
          return { status: "setup_required", reason: "openai_compatible_unavailable" };
        }
        return {
          status: "error",
          error: redactOpenAISecrets(error.message, this.apiKey),
        };
      }
      return {
        status: "error",
        error: "OpenAI-compatible provider check failed.",
      };
    }
  }

  async startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin> {
    throw new CodexAppServerError(
      "setup_required",
      "Device-code login is not supported when TRAUMA_LLM_PROVIDER=openai_compatible.",
    );
  }

  async cancelDeviceCodeLogin(_input: { loginId: string }): Promise<void> {
    return;
  }

  async logout(): Promise<CodexLogoutResult> {
    return {
      status: "unsupported",
      message:
        "OpenAI-compatible provider credentials are managed via environment variables.",
    };
  }

  async *observeAuthEvents(): AsyncIterable<CodexAuthEvent> {
    // OpenAI-compatible mode does not emit device-code auth events.
  }

  async listModels(): Promise<CodexModelCatalog> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.buildHeaders(false),
    });
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    const payload = await this.readJsonResponse(
      response,
      "OpenAI-compatible provider returned invalid model catalog JSON.",
    );
    const catalog = parseOpenAIModelCatalog(payload, this.defaultModel);
    const preferred =
      catalog.models.find((model) => model.isDefault) ?? catalog.models[0];
    if (preferred !== undefined) {
      this.cachedDefaultModel = preferred.model;
    }
    return catalog;
  }

  async translateChunk(
    input: TranslateChunkInput,
  ): Promise<RawCodexChunkOutput> {
    const model = await this.resolveModel(input.model);
    const threadId = `openai-translation-${input.chunk.jobId}-${input.chunk.chunkIndex}`;
    const turnId = `openai-turn-${randomUUID()}`;
    const control = this.registerActiveTurn(threadId, turnId);
    const timeout = this.scheduleTimeout(control);
    try {
      assertEventAccepted(input.onEvent, { type: "thread.started", threadId }, control);
      assertEventAccepted(input.onEvent, { type: "turn.started", turnId }, control);

      const useJsonObject = this.responseFormatMode === "json_object";
      let response: Response;
      try {
        response = await this.postChatCompletion(
          {
            messages: [{ role: "user", content: input.prompt }],
            model,
            stream: false,
            ...(useJsonObject
              ? { response_format: { type: "json_object" } }
              : {}),
          },
          control,
        );
      } catch (error) {
        if (useJsonObject && isResponseFormatUnsupportedError(error)) {
          this.responseFormatMode = "prompt_only";
          response = await this.postChatCompletion(
            {
              messages: [{ role: "user", content: input.prompt }],
              model,
              stream: false,
            },
            control,
          );
        } else {
          throw error;
        }
      }

      const payload = await this.readJsonResponse(
        response,
        "OpenAI-compatible provider returned invalid translation JSON.",
      );
      const text = extractNonStreamingCompletionText(payload);
      if (text === undefined) {
        throw new CodexAppServerError(
          "invalid_final_output",
          "OpenAI-compatible provider returned an empty translation response.",
        );
      }
      const parsed = parseTranslationJsonOutput(text);
      if (parsed === undefined) {
        throw new CodexAppServerError(
          "invalid_final_output",
          "OpenAI-compatible provider returned malformed translation JSON.",
        );
      }
      assertEventAccepted(input.onEvent, { type: "item.completed", itemId: turnId }, control);
      return parsed;
    } catch (error) {
      throw this.normalizeTurnError(error, control);
    } finally {
      clearTimeout(timeout);
      this.activeTurns.delete(turnId);
    }
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    const model = await this.resolveModel(input.model);
    const threadId = input.threadId ?? `openai-thread-${randomUUID()}`;
    const turnId = `openai-turn-${randomUUID()}`;
    const control = this.registerActiveTurn(threadId, turnId);
    const timeout = this.scheduleTimeout(control);
    try {
      assertEventAccepted(input.onEvent, { type: "thread.started", threadId }, control);
      assertEventAccepted(input.onEvent, { type: "turn.started", turnId }, control);

      const response = await this.postChatCompletion(
        {
          messages: [{ role: "user", content: input.input }],
          model,
          stream: true,
        },
        control,
      );

      if (response.body === null) {
        throw new CodexAppServerError(
          "stream_disconnected",
          "OpenAI-compatible provider returned an empty SSE stream.",
        );
      }

      const outputText = await this.consumeSseStream(
        response.body,
        input.onEvent,
        control,
      );

      assertEventAccepted(input.onEvent, { type: "item.completed", itemId: turnId }, control);
      return {
        outputText,
        threadId,
        turnId,
      };
    } catch (error) {
      throw this.normalizeTurnError(error, control);
    } finally {
      clearTimeout(timeout);
      this.activeTurns.delete(turnId);
    }
  }

  async cancelTurn(input: { threadId: string; turnId: string }): Promise<void> {
    const direct = this.activeTurns.get(input.turnId);
    if (direct !== undefined) {
      direct.reason = "canceled";
      direct.controller.abort();
      return;
    }
    for (const control of this.activeTurns.values()) {
      if (control.threadId === input.threadId) {
        control.reason = "canceled";
        control.controller.abort();
      }
    }
  }

  async close(): Promise<void> {
    for (const control of this.activeTurns.values()) {
      control.reason = "canceled";
      control.controller.abort();
    }
    this.activeTurns.clear();
  }

  private registerActiveTurn(
    threadId: string,
    turnId: string,
  ): ActiveTurnControl {
    const control: ActiveTurnControl = {
      controller: new AbortController(),
      threadId,
    };
    this.activeTurns.set(turnId, control);
    return control;
  }

  private scheduleTimeout(
    control: ActiveTurnControl,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      control.reason = "timeout";
      control.controller.abort();
    }, this.requestTimeoutMs);
  }

  private buildHeaders(includeJsonContentType: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
    };
    if (includeJsonContentType) {
      headers["Content-Type"] = "application/json";
    }
    if (this.apiKey !== undefined) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async resolveModel(requestedModel?: string | null): Promise<string> {
    const explicit = requestedModel?.trim();
    if (explicit !== undefined && explicit !== "") {
      return explicit;
    }
    if (this.defaultModel !== undefined) {
      return this.defaultModel;
    }
    if (this.cachedDefaultModel !== undefined) {
      return this.cachedDefaultModel;
    }
    const catalog = await this.listModels();
    const fallback =
      catalog.models.find((model) => model.isDefault) ?? catalog.models[0];
    if (fallback === undefined) {
      throw new CodexAppServerError(
        "setup_required",
        "No model is configured or available from the OpenAI-compatible provider.",
      );
    }
    this.cachedDefaultModel = fallback.model;
    return fallback.model;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new CodexAppServerError(
          "timeout",
          "OpenAI-compatible provider request timed out.",
        );
      }
      throw new CodexAppServerError(
        "app_server_unavailable",
        redactOpenAISecrets(
          error instanceof Error
            ? `OpenAI-compatible provider request failed: ${error.message}`
            : "OpenAI-compatible provider is unavailable.",
          this.apiKey,
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postChatCompletion(
    body: Record<string, unknown>,
    control: ActiveTurnControl,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(true),
        body: JSON.stringify(body),
        signal: control.controller.signal,
      });
    } catch (error) {
      if (control.controller.signal.aborted) {
        throw this.abortErrorForControl(control);
      }
      throw new CodexAppServerError(
        "app_server_unavailable",
        redactOpenAISecrets(
          error instanceof Error
            ? `OpenAI-compatible provider request failed: ${error.message}`
            : "OpenAI-compatible provider is unavailable.",
          this.apiKey,
        ),
      );
    }

    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return response;
  }

  private async consumeSseStream(
    body: ReadableStream<Uint8Array>,
    onEvent: CodexAppServerEventHandler | undefined,
    control: ActiveTurnControl,
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let dataLines: string[] = [];
    let outputText = "";
    let sawDone = false;
    let sawFinishReason = false;

    const processEventPayload = (rawPayload: string) => {
      const payload = rawPayload.trim();
      if (payload === "") {
        return;
      }
      if (payload === "[DONE]") {
        sawDone = true;
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new CodexAppServerError(
          "app_server_protocol_error",
          "OpenAI-compatible provider sent a malformed SSE JSON chunk.",
        );
      }
      if (!isRecord(parsed)) {
        throw new CodexAppServerError(
          "app_server_protocol_error",
          "OpenAI-compatible provider sent a non-object SSE chunk.",
        );
      }
      if (isRecord(parsed.error)) {
        const message = redactOpenAISecrets(
          typeof parsed.error.message === "string"
            ? parsed.error.message
            : "OpenAI-compatible stream returned an error event.",
          this.apiKey,
        );
        const code = classifyErrorMessage(message);
        throw new CodexAppServerError(code, message);
      }
      if (parsed.choices !== undefined && !Array.isArray(parsed.choices)) {
        throw new CodexAppServerError(
          "app_server_protocol_error",
          "OpenAI-compatible provider sent an invalid SSE choices payload.",
        );
      }
      const firstChoice = Array.isArray(parsed.choices)
        ? parsed.choices[0]
        : undefined;
      if (isRecord(firstChoice)) {
        if (typeof firstChoice.finish_reason === "string" && firstChoice.finish_reason !== "") {
          sawFinishReason = true;
        }
        const deltaText = extractChoiceDeltaText(firstChoice);
        if (deltaText !== undefined && deltaText.length > 0) {
          outputText += deltaText;
          assertEventAccepted(onEvent, { type: "delta", text: deltaText }, control);
        }
      }
    };

    const handleLine = (line: string) => {
      if (line === "") {
        if (dataLines.length > 0) {
          const payload = dataLines.join("\n");
          dataLines = [];
          processEventPayload(payload);
        }
        return;
      }
      if (line.startsWith(":")) {
        return;
      }
      if (line.startsWith("data:")) {
        dataLines.push(
          line.startsWith("data: ") ? line.slice(6) : line.slice(5),
        );
      }
    };

    try {
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          handleLine(line);
          if (sawDone) {
            break;
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }
      if (!sawDone) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          const remainingLines = buffer.split(/\r?\n/);
          for (const line of remainingLines) {
            handleLine(line);
            if (sawDone) {
              break;
            }
          }
        }
        if (!sawDone && dataLines.length > 0) {
          const payload = dataLines.join("\n");
          dataLines = [];
          processEventPayload(payload);
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore stream cancel errors during cleanup.
      }
      reader.releaseLock();
    }

    if (control.controller.signal.aborted) {
      throw this.abortErrorForControl(control);
    }
    if (!sawDone && !sawFinishReason && outputText.length === 0) {
      throw new CodexAppServerError(
        "stream_disconnected",
        "OpenAI-compatible stream ended before completing.",
      );
    }
    return outputText;
  }

  private async readJsonResponse(
    response: Response,
    fallbackErrorMessage: string,
  ): Promise<unknown> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new CodexAppServerError(
        "stream_disconnected",
        "Failed to read response from OpenAI-compatible provider.",
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new CodexAppServerError(
        "app_server_protocol_error",
        fallbackErrorMessage,
      );
    }
  }

  private async createHttpError(response: Response): Promise<CodexAppServerError> {
    let rawBody = "";
    try {
      rawBody = await response.text();
    } catch {
      rawBody = "";
    }
    const detail = extractHttpErrorDetail(rawBody, this.apiKey);
    const status = response.status;
    if (status === 401 || status === 403) {
      return new CodexAppServerError(
        "auth_required",
        detail === undefined
          ? `OpenAI-compatible provider rejected authentication (HTTP ${status}).`
          : `OpenAI-compatible provider rejected authentication (HTTP ${status}): ${detail}`,
      );
    }
    if (status === 429) {
      return new CodexAppServerError(
        "usage_limit",
        detail === undefined
          ? "OpenAI-compatible provider rate limit reached (HTTP 429)."
          : `OpenAI-compatible provider rate limit reached (HTTP 429): ${detail}`,
      );
    }
    if (status === 408 || status === 504) {
      return new CodexAppServerError(
        "timeout",
        detail === undefined
          ? `OpenAI-compatible provider timed out (HTTP ${status}).`
          : `OpenAI-compatible provider timed out (HTTP ${status}): ${detail}`,
      );
    }
    if (status >= 500) {
      return new CodexAppServerError(
        "app_server_unavailable",
        detail === undefined
          ? `OpenAI-compatible provider returned HTTP ${status}.`
          : `OpenAI-compatible provider returned HTTP ${status}: ${detail}`,
      );
    }
    if (
      (status === 400 || status === 413) &&
      detail !== undefined &&
      /context|token|too long|maximum context/i.test(detail)
    ) {
      return new CodexAppServerError(
        "context_overflow",
        `OpenAI-compatible provider rejected request due to context limit (HTTP ${status}): ${detail}`,
      );
    }
    return new CodexAppServerError(
      "app_server_protocol_error",
      detail === undefined
        ? `OpenAI-compatible provider returned HTTP ${status}.`
        : `OpenAI-compatible provider returned HTTP ${status}: ${detail}`,
    );
  }

  private abortErrorForControl(control: ActiveTurnControl): CodexAppServerError {
    if (control.reason === "backpressure") {
      return new CodexAppServerError(
        "event_limit_exceeded",
        "OpenAI-compatible event consumer rejected further events.",
      );
    }
    if (control.reason === "timeout") {
      return new CodexAppServerError(
        "timeout",
        "OpenAI-compatible provider request timed out.",
      );
    }
    return new CodexAppServerError(
      "turn_interrupted",
      "OpenAI-compatible turn was interrupted.",
    );
  }

  private normalizeTurnError(
    error: unknown,
    control: ActiveTurnControl,
  ): CodexAppServerError {
    if (error instanceof CodexAppServerError) {
      return new CodexAppServerError(
        error.code,
        redactOpenAISecrets(error.message, this.apiKey),
      );
    }
    if (control.controller.signal.aborted) {
      return this.abortErrorForControl(control);
    }
    return new CodexAppServerError(
      "unknown",
      redactOpenAISecrets(
        error instanceof Error
          ? error.message
          : "OpenAI-compatible request failed.",
        this.apiKey,
      ),
    );
  }
}

function assertEventAccepted(
  onEvent: CodexAppServerEventHandler | undefined,
  event: CodexAppServerEvent,
  control: ActiveTurnControl,
): void {
  if (onEvent?.(event) === false) {
    control.reason = "backpressure";
    control.controller.abort();
    throw new CodexAppServerError(
      "event_limit_exceeded",
      "OpenAI-compatible event consumer rejected further events.",
    );
  }
}

function parseOpenAIModelCatalog(
  payload: unknown,
  defaultModel?: string,
): CodexModelCatalog {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new CodexAppServerError(
      "app_server_protocol_error",
      "OpenAI-compatible provider returned an invalid model catalog.",
    );
  }
  const seen = new Set<string>();
  const rawModels: Array<{
    description: string;
    displayName: string;
    id: string;
  }> = [];
  for (const row of payload.data) {
    if (!isRecord(row) || typeof row.id !== "string" || row.id.trim() === "") {
      throw new CodexAppServerError(
        "app_server_protocol_error",
        "OpenAI-compatible provider returned an invalid model entry.",
      );
    }
    const id = row.id.trim();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const displayName =
      (typeof row.display_name === "string" && row.display_name.trim() !== ""
        ? row.display_name.trim()
        : undefined) ??
      (typeof row.name === "string" && row.name.trim() !== ""
        ? row.name.trim()
        : undefined) ??
      id;
    const description =
      (typeof row.description === "string" && row.description.trim() !== ""
        ? row.description.trim()
        : undefined) ??
      (typeof row.owned_by === "string" && row.owned_by.trim() !== ""
        ? `Owned by ${row.owned_by.trim()}`
        : "OpenAI-compatible model");
    rawModels.push({ id, displayName, description });
  }

  const hasExactDefault =
    defaultModel !== undefined &&
    rawModels.some((entry) => entry.id === defaultModel);
  const models: CodexModelInfo[] = rawModels.map((entry, index) => ({
    id: entry.id,
    model: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    isDefault: hasExactDefault ? entry.id === defaultModel : index === 0,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...CODEX_REASONING_EFFORTS],
  }));

  return { models };
}

function extractChoiceDeltaText(choice: Record<string, unknown>): string | undefined {
  const delta = choice.delta;
  if (!isRecord(delta)) {
    return undefined;
  }
  return extractContentText(delta.content);
}

function extractNonStreamingCompletionText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return undefined;
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return undefined;
  }
  return extractContentText(firstChoice.message.content);
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (isRecord(part) && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
    return parts.length > 0 ? parts.join("") : undefined;
  }
  return undefined;
}

function parseTranslationJsonOutput(
  text: string,
): RawCodexChunkOutput | undefined {
  const trimmed = stripJsonFence(text.trim());
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) && Array.isArray(parsed.segments)
      ? (parsed as unknown as RawCodexChunkOutput)
      : undefined;
  } catch {
    return undefined;
  }
}

function stripJsonFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match?.[1] ?? text;
}

function extractHttpErrorDetail(
  rawBody: string,
  apiKey?: string,
): string | undefined {
  const trimmed = rawBody.trim();
  if (trimmed === "") {
    return undefined;
  }
  let detail = trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
        detail = parsed.error.message;
      } else if (typeof parsed.message === "string") {
        detail = parsed.message;
      }
    }
  } catch {
    // Keep raw text body when error response is not JSON.
  }
  const redacted = redactOpenAISecrets(detail, apiKey).replace(/\s+/g, " ").trim();
  if (redacted === "") {
    return undefined;
  }
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

function classifyErrorMessage(
  message: string,
): CodexAppServerError["code"] {
  const normalized = message.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("unauthorized") || normalized.includes("invalid api key")) {
    return "auth_required";
  }
  if (normalized.includes("rate limit") || normalized.includes("quota") || normalized.includes("too many requests")) {
    return "usage_limit";
  }
  if (normalized.includes("context") || normalized.includes("token")) {
    return "context_overflow";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "timeout";
  }
  return "app_server_protocol_error";
}

function isResponseFormatUnsupportedError(error: unknown): boolean {
  if (!(error instanceof CodexAppServerError)) {
    return false;
  }
  if (error.code !== "app_server_protocol_error") {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return (
    /response_format|json_object|structured/.test(normalized) &&
    /unsupported|unknown|invalid|unrecognized|not supported|not allowed/.test(
      normalized,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
