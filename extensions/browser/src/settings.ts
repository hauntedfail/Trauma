import type { ExtensionSettings } from "./types";

export const DEFAULT_TRAUMA_URL = "http://127.0.0.1:3000";

const STORAGE_KEYS = ["traumaUrl", "token"] as const;

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const traumaUrl =
    typeof stored.traumaUrl === "string" ? stored.traumaUrl : DEFAULT_TRAUMA_URL;
  const token = typeof stored.token === "string" ? stored.token : "";

  return {
    traumaUrl: normalizeTraumaUrl(traumaUrl).value ?? DEFAULT_TRAUMA_URL,
    token,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const normalized = normalizeTraumaUrl(settings.traumaUrl);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  await chrome.storage.local.set({
    traumaUrl: normalized.value,
    token: settings.token.trim(),
  });
}

export function normalizeTraumaUrl(value: string):
  | { ok: true; value: string }
  | { ok: false; error: string; value?: never } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: "Enter a valid TRAUMA instance URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "TRAUMA URL must use http or https." };
  }

  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return {
      ok: false,
      error: "TRAUMA URL must use localhost or 127.0.0.1.",
    };
  }

  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";

  return { ok: true, value: url.toString().replace(/\/$/, "") };
}
