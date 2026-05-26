import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  SUPPORTED_TRANSLATION_LANGUAGES,
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from "../../settings/languages";
import { loadRuntimeTraumaConfig, type ResolvedTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { SettingsRepository } from "../db/repositories";
import {
  enableOpenAiAuthWithRepository,
  deleteOpenAiAuthWithRepository,
  type DeleteOpenAiAuthResult,
  type EnableOpenAiAuthResponse,
} from "./openai-auth";
import {
  readCodexAuthStatus,
  type CodexAuthStatusResponse,
} from "./codex-auth";
import {
  isCodexReasoningEffort,
  type CodexReasoningEffort,
} from "../translation/types";

export interface SettingsState {
  codexTranslationModel: string | null;
  codexTranslationReasoningEffort: CodexReasoningEffort | null;
  translationTargetLanguage: SupportedLanguageCode;
  openaiAuth: CodexAuthStatusResponse;
}

interface SettingsOptions {
  config?: ResolvedTraumaConfig;
  now?: Date;
}

export class UnsupportedTranslationLanguageError extends Error {
  constructor(language: string) {
    super(`Unsupported translation target language: ${language}`);
    this.name = "UnsupportedTranslationLanguageError";
  }
}

export class UnsupportedCodexReasoningEffortError extends Error {
  constructor(effort: string) {
    super(`Unsupported Codex reasoning effort: ${effort}`);
    this.name = "UnsupportedCodexReasoningEffortError";
  }
}

export async function getSettings(
  options: SettingsOptions = {},
): Promise<SettingsState> {
  return withSettingsRepository(options, async (repository, now) => {
    const settings = await repository.getSettings(now);
    return {
      codexTranslationModel: settings.codexTranslationModel,
      codexTranslationReasoningEffort: settings.codexTranslationReasoningEffort,
      translationTargetLanguage: settings.translationTargetLanguage,
      openaiAuth: await readCodexAuthStatus(),
    };
  });
}

export async function updateTranslationTargetLanguage(
  language: string,
  options: SettingsOptions = {},
): Promise<SettingsState> {
  if (!isSupportedLanguageCode(language)) {
    throw new UnsupportedTranslationLanguageError(language);
  }

  return withSettingsRepository(options, async (repository, now) => {
    const settings = await repository.updateTranslationTargetLanguage({
      language,
      updatedAt: now,
    });
    return {
      codexTranslationModel: settings.codexTranslationModel,
      codexTranslationReasoningEffort: settings.codexTranslationReasoningEffort,
      translationTargetLanguage: settings.translationTargetLanguage,
      openaiAuth: await readCodexAuthStatus(),
    };
  });
}

export async function updateCodexTranslationDefaults(input: {
  config?: ResolvedTraumaConfig;
  model?: string | null;
  now?: Date;
  reasoningEffort?: string | null;
}): Promise<SettingsState> {
  return withSettingsRepository(input, async (repository, now) => {
    const current = await repository.getSettings(now);
    const model = input.model === undefined
      ? current.codexTranslationModel
      : normalizeOptionalString(input.model);
    const reasoningEffort = input.reasoningEffort === undefined
      ? current.codexTranslationReasoningEffort
      : normalizeCodexReasoningEffort(input.reasoningEffort);
    const settings = await repository.updateCodexTranslationDefaults({
      model,
      reasoningEffort,
      updatedAt: now,
    });
    return {
      codexTranslationModel: settings.codexTranslationModel,
      codexTranslationReasoningEffort: settings.codexTranslationReasoningEffort,
      translationTargetLanguage: settings.translationTargetLanguage,
      openaiAuth: await readCodexAuthStatus(),
    };
  });
}

export async function getCodexTranslationDefaults(
  options: SettingsOptions = {},
): Promise<{
  model: string | null;
  reasoningEffort: CodexReasoningEffort | null;
}> {
  return withSettingsRepository(options, async (repository, now) => {
    const settings = await repository.getSettings(now);
    return {
      model: settings.codexTranslationModel,
      reasoningEffort: settings.codexTranslationReasoningEffort,
    };
  });
}

export async function enableSettingsOpenAiAuth(
  options: SettingsOptions = {},
): Promise<EnableOpenAiAuthResponse> {
  return withSettingsRepository(options, (repository, now) =>
    enableOpenAiAuthWithRepository(repository, now),
  );
}

export async function deleteSettingsOpenAiAuth(
  options: SettingsOptions = {},
): Promise<DeleteOpenAiAuthResult> {
  return withSettingsRepository(options, (repository) =>
    deleteOpenAiAuthWithRepository(repository),
  );
}

export function getSupportedTranslationLanguages() {
  return SUPPORTED_TRANSLATION_LANGUAGES;
}

export { DEFAULT_TRANSLATION_TARGET_LANGUAGE };

function normalizeCodexReasoningEffort(
  effort: string | null,
): CodexReasoningEffort | null {
  const normalized = normalizeOptionalString(effort);
  if (normalized === null) {
    return null;
  }
  if (!isCodexReasoningEffort(normalized)) {
    throw new UnsupportedCodexReasoningEffortError(normalized);
  }
  return normalized;
}

function normalizeOptionalString(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function withSettingsRepository<T>(
  options: SettingsOptions,
  callback: (repository: SettingsRepository, now: Date) => Promise<T>,
): Promise<T> {
  const config = options.config ?? loadRuntimeTraumaConfig();
  const connection = initializeDatabase(config);
  try {
    return await callback(connection.repositories.settings, options.now ?? new Date());
  } finally {
    connection.close();
  }
}
