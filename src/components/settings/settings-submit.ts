import type { SettingsState } from "../../server/settings/settings";
import type {
  CodexAuthDeleteResponse,
  CodexDeviceCodeStartResponse,
} from "../../server/settings/codex-auth";

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
} = {}): Promise<CodexDeviceCodeStartResponse> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/codex-auth/device-code", {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "failed to start Codex auth"));
  }

  return response.json() as Promise<CodexDeviceCodeStartResponse>;
}

export async function submitDeleteOpenAiAuth(input: {
  confirm: (message: string) => boolean;
  fetch?: FetchFunction;
}): Promise<CodexAuthDeleteResponse | undefined> {
  if (!input.confirm("Delete Codex auth?")) {
    return undefined;
  }

  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/codex-auth", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("failed to delete Codex auth");
  }

  return response.json() as Promise<CodexAuthDeleteResponse>;
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string" &&
      body.message.trim() !== ""
    ) {
      return body.message;
    }
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error.trim() !== ""
    ) {
      return body.error;
    }
  } catch {
    // Fall back to the stable caller-facing message below.
  }

  return fallback;
}
