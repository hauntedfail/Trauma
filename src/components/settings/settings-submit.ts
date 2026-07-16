import type { SettingsState } from "../../server/settings/settings";
import type { CodexModelCatalog } from "../../server/translation/codex-app-server";
import type { CodexReasoningEffort } from "../../server/translation/types";
import type {
  CodexAuthDeleteResponse,
  CodexAuthStatusResponse,
  CodexDeviceCodeCancelResponse,
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

export async function submitReadCodexModels(input: {
  fetch?: FetchFunction;
} = {}): Promise<CodexModelCatalog> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/codex-models", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "failed to read Codex models"));
  }

  return response.json() as Promise<CodexModelCatalog>;
}

export async function submitCodexTranslationDefaults(input: {
  fetch?: FetchFunction;
  model: string | null;
  reasoningEffort: CodexReasoningEffort | null;
}): Promise<SettingsState> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/translation-codex-defaults", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      reasoning_effort: input.reasoningEffort,
    }),
  });
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "failed to update Codex translation defaults"),
    );
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

export async function submitReadCodexAuth(input: {
  fetch?: FetchFunction;
} = {}): Promise<CodexAuthStatusResponse> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/settings/codex-auth", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "failed to read Codex auth"));
  }

  return response.json() as Promise<CodexAuthStatusResponse>;
}

export async function pollCodexAuthSetup(input: {
  fetch?: FetchFunction;
  intervalMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
} = {}): Promise<CodexAuthStatusResponse | undefined> {
  const intervalMs = input.intervalMs ?? 1_500;
  const maxAttempts = input.maxAttempts ?? 120;
  let lastStatus: CodexAuthStatusResponse | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ready = await waitForPollDelay(intervalMs, input.signal);
    if (!ready) {
      return undefined;
    }
    const status = await submitReadCodexAuth({ fetch: input.fetch });
    lastStatus = status;
    if (status.status !== "login_started") {
      return status;
    }
  }

  return lastStatus;
}

export async function submitCancelCodexAuthSetup(input: {
  fetch?: FetchFunction;
} = {}): Promise<CodexDeviceCodeCancelResponse> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch(
    "/api/settings/codex-auth/device-code/cancel",
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "failed to cancel Codex auth setup"),
    );
  }

  return response.json() as Promise<CodexDeviceCodeCancelResponse>;
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

function waitForPollDelay(
  intervalMs: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (signal?.aborted === true) {
    return Promise.resolve(false);
  }
  if (intervalMs <= 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, intervalMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
