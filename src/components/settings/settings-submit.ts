import type { SettingsState } from "../../server/settings/settings";
import type {
  DeleteOpenAiAuthResult,
  EnableOpenAiAuthResult,
} from "../../server/settings/openai-auth";

type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function submitTranslationTargetLanguage(input: {
  fetch?: FetchFunction;
  language: string;
}): Promise<SettingsState> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/translation-language", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ language: input.language }),
  });
  if (!response.ok) {
    throw new Error("failed to update translation target language");
  }

  return response.json() as Promise<SettingsState>;
}

export async function submitEnableOpenAiAuth(input: {
  fetch?: FetchFunction;
} = {}): Promise<EnableOpenAiAuthResult> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/openai-auth/enable", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("failed to enable OpenAI auth");
  }

  return response.json() as Promise<EnableOpenAiAuthResult>;
}

export async function submitDeleteOpenAiAuth(input: {
  confirm: (message: string) => boolean;
  fetch?: FetchFunction;
}): Promise<DeleteOpenAiAuthResult | undefined> {
  if (!input.confirm("Delete OpenAI auth?")) {
    return undefined;
  }

  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/openai-auth", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("failed to delete OpenAI auth");
  }

  return response.json() as Promise<DeleteOpenAiAuthResult>;
}
