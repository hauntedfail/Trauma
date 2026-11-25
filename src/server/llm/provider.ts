import type { CodexAuthClient } from "../settings/codex-auth";
import {
  CodexAppServerClient,
  CodexAppServerError,
  type CodexConversationClient,
  type CodexModelCatalog,
  type TranslationClient,
} from "../translation/codex-app-server";
import {
  DEFAULT_OPENAI_REQUEST_TIMEOUT_MS,
  normalizeOpenAIBaseUrl,
  OpenAICompatibleClient,
} from "./openai-compatible-client";

export const LLM_PROVIDER_ENV = "TRAUMA_LLM_PROVIDER";
export const OPENAI_BASE_URL_ENV = "TRAUMA_OPENAI_BASE_URL";
export const OPENAI_API_KEY_ENV = "TRAUMA_OPENAI_API_KEY";
export const OPENAI_DEFAULT_MODEL_ENV = "TRAUMA_OPENAI_DEFAULT_MODEL";
export const OPENAI_REQUEST_TIMEOUT_MS_ENV = "TRAUMA_OPENAI_REQUEST_TIMEOUT_MS";

export type LlmProviderKind = "codex" | "openai_compatible";

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseUrl: string;
  defaultModel?: string;
  requestTimeoutMs: number;
}

export interface LlmModelsClient {
  close?: () => Promise<void> | void;
  listModels: () => Promise<CodexModelCatalog>;
}

export interface LlmProviderFactoryOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
}

export function resolveLlmProviderKind(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LlmProviderKind {
  const raw = environment[LLM_PROVIDER_ENV]?.trim().toLowerCase();
  if (raw === undefined || raw === "" || raw === "codex") {
    return "codex";
  }
  if (raw === "openai_compatible") {
    return "openai_compatible";
  }
  throw new CodexAppServerError(
    "setup_required",
    `Unsupported ${LLM_PROVIDER_ENV} value. Expected "codex" or "openai_compatible".`,
  );
}

export function isOpenAICompatibleProviderEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = environment[LLM_PROVIDER_ENV]?.trim().toLowerCase();
  return raw === "openai_compatible";
}

export function readOpenAICompatibleConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OpenAICompatibleConfig {
  const baseUrl = normalizeOpenAIBaseUrl(environment[OPENAI_BASE_URL_ENV] ?? "");
  const rawApiKey = environment[OPENAI_API_KEY_ENV]?.trim();
  const rawDefaultModel = environment[OPENAI_DEFAULT_MODEL_ENV]?.trim();
  const rawTimeout = environment[OPENAI_REQUEST_TIMEOUT_MS_ENV]?.trim();
  let requestTimeoutMs = DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout !== "") {
    const parsed = Number(rawTimeout);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      requestTimeoutMs = parsed;
    }
  }
  return {
    baseUrl,
    ...(rawApiKey !== undefined && rawApiKey !== "" ? { apiKey: rawApiKey } : {}),
    ...(rawDefaultModel !== undefined && rawDefaultModel !== ""
      ? { defaultModel: rawDefaultModel }
      : {}),
    requestTimeoutMs,
  };
}

function createProviderClient(
  options: LlmProviderFactoryOptions = {},
): CodexAppServerClient | OpenAICompatibleClient {
  const environment = options.environment ?? process.env;
  const provider = resolveLlmProviderKind(environment);
  if (provider === "openai_compatible") {
    const config = readOpenAICompatibleConfig(environment);
    return new OpenAICompatibleClient({
      ...config,
      fetch: options.fetch,
    });
  }
  return new CodexAppServerClient();
}

export function createLlmTranslationClient(
  options?: LlmProviderFactoryOptions,
): TranslationClient {
  return createProviderClient(options);
}

export function createLlmConversationClient(
  options?: LlmProviderFactoryOptions,
): CodexConversationClient {
  return createProviderClient(options);
}

export function createLlmModelsClient(
  options?: LlmProviderFactoryOptions,
): LlmModelsClient {
  return createProviderClient(options);
}

export function createLlmAuthClient(
  options?: LlmProviderFactoryOptions,
): CodexAuthClient {
  return createProviderClient(options);
}
