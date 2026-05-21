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

export interface SettingsState {
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

export async function getSettings(
  options: SettingsOptions = {},
): Promise<SettingsState> {
  return withSettingsRepository(options, async (repository, now) => {
    const settings = await repository.getSettings(now);
    return {
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
    await repository.updateTranslationTargetLanguage({
      language,
      updatedAt: now,
    });
    return {
      translationTargetLanguage: language,
      openaiAuth: await readCodexAuthStatus(),
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
