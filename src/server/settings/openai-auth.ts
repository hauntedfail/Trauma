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

export interface DeleteOpenAiAuthResult {
  status: "disabled";
  alreadyDisabled: boolean;
}

interface OpenAiAuthOptions {
  config?: ResolvedTraumaConfig;
  now?: Date;
}

const OPENAI_AUTH_PROVIDER = "task18-local";
const OPENAI_AUTH_CREDENTIAL_REFERENCE = "task18-local-openai-auth";

export async function getOpenAiAuthStatus(
  options: OpenAiAuthOptions = {},
): Promise<OpenAiAuthStatus> {
  return withSettingsRepository(options, (repository) =>
    readOpenAiAuthStatus(repository),
  );
}

export async function enableOpenAiAuth(
  options: OpenAiAuthOptions = {},
): Promise<EnableOpenAiAuthResult> {
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
  now: Date,
): Promise<EnableOpenAiAuthResult> {
  const status = await readOpenAiAuthStatus(repository);
  if (status === "enabled") {
    return {
      status: "enabled",
      alreadyEnabled: true,
      message: "OpenAI auth is already enabled.",
    };
  }

  await repository.createOpenAiAuthCredential({
    provider: OPENAI_AUTH_PROVIDER,
    credentialReference: OPENAI_AUTH_CREDENTIAL_REFERENCE,
    now,
  });
  return {
    status: "enabled",
    alreadyEnabled: false,
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
