import { loadRuntimeTraumaConfig, type ResolvedTraumaConfig } from "../config";
import { initializeDatabase } from "../db";
import type { SettingsRepository } from "../db/repositories";

export type OpenAiAuthStatus = "disabled" | "enabled";

export interface OpenAiAuthStatusView {
  status: OpenAiAuthStatus;
}

export interface EnableOpenAiAuthResult {
  status: "enabled";
  alreadyEnabled: boolean;
  message?: string;
}

export interface OpenAiAuthNotConfiguredResult {
  status: "not_configured";
  message: string;
}

export type EnableOpenAiAuthResponse =
  | EnableOpenAiAuthResult
  | OpenAiAuthNotConfiguredResult;

export interface DeleteOpenAiAuthResult {
  status: "disabled";
  alreadyDisabled: boolean;
}

interface OpenAiAuthOptions {
  config?: ResolvedTraumaConfig;
  now?: Date;
}

const OPENAI_AUTH_NOT_CONFIGURED_MESSAGE =
  "OpenAI auth provider is not configured.";

export async function getOpenAiAuthStatus(
  options: OpenAiAuthOptions = {},
): Promise<OpenAiAuthStatus> {
  return withSettingsRepository(options, (repository) =>
    readOpenAiAuthStatus(repository),
  );
}

export async function enableOpenAiAuth(
  options: OpenAiAuthOptions = {},
): Promise<EnableOpenAiAuthResponse> {
  return withSettingsRepository(options, (repository) =>
    enableOpenAiAuthWithRepository(repository, options.now ?? new Date()),
  );
}

export async function deleteOpenAiAuth(
  options: OpenAiAuthOptions = {},
): Promise<DeleteOpenAiAuthResult> {
  return withSettingsRepository(options, (repository) =>
    deleteOpenAiAuthWithRepository(repository),
  );
}

export async function readOpenAiAuthStatus(
  repository: SettingsRepository,
): Promise<OpenAiAuthStatus> {
  const credential = await repository.getOpenAiAuthCredential();
  return credential === undefined ? "disabled" : "enabled";
}

export async function enableOpenAiAuthWithRepository(
  repository: SettingsRepository,
  _now: Date,
): Promise<EnableOpenAiAuthResponse> {
  const status = await readOpenAiAuthStatus(repository);
  if (status === "enabled") {
    return {
      status: "enabled",
      alreadyEnabled: true,
      message: "OpenAI auth is already enabled.",
    };
  }

  return {
    status: "not_configured",
    message: OPENAI_AUTH_NOT_CONFIGURED_MESSAGE,
  };
}

export async function deleteOpenAiAuthWithRepository(
  repository: SettingsRepository,
): Promise<DeleteOpenAiAuthResult> {
  const deleted = await repository.deleteOpenAiAuthCredential();
  return {
    status: "disabled",
    alreadyDisabled: !deleted,
  };
}

async function withSettingsRepository<T>(
  options: OpenAiAuthOptions,
  callback: (repository: SettingsRepository) => Promise<T>,
): Promise<T> {
  const config = options.config ?? loadRuntimeTraumaConfig();
  const connection = initializeDatabase(config);
  try {
    return await callback(connection.repositories.settings);
  } finally {
    connection.close();
  }
}
