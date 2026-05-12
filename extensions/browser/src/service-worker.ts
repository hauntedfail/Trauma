import { normalizeTraumaUrl } from "./settings";
import type {
  BrowserImportResponse,
  BrowserImportSuccess,
  CapturedTabSnapshot,
  CaptureResult,
  ExtensionSettings,
  RuntimeMessage,
} from "./types";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "IMPORT_CURRENT_TAB") {
    return undefined;
  }

  void importCurrentTab(message.settings).then(sendResponse);
  return true;
});

async function importCurrentTab(
  settings: ExtensionSettings,
): Promise<BrowserImportResponse> {
  const normalizedUrl = normalizeTraumaUrl(settings.traumaUrl);
  if (!normalizedUrl.ok) {
    return { ok: false, error: normalizedUrl.error };
  }

  const token = settings.token.trim();
  if (token.length === 0) {
    return { ok: false, error: "Configure a browser import token first." };
  }

  const tab = await readActiveTab();
  if (tab.id === undefined) {
    return { ok: false, error: "Could not find the active tab." };
  }

  const snapshot = await captureTab(tab.id);
  if (!snapshot.ok) {
    return { ok: false, error: snapshot.error };
  }

  return postSnapshot({
    traumaUrl: normalizedUrl.value,
    token,
    snapshot: snapshot.snapshot,
  });
}

async function readActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? {};
}

async function captureTab(tabId: number): Promise<CaptureResult> {
  let injection: { result?: CaptureResult } | undefined;
  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["inject.bundle.js"],
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not capture the page: ${formatUnknownError(error)}`,
    };
  }

  return injection?.result ?? { ok: false, error: "Could not capture the page." };
}

async function postSnapshot(input: {
  traumaUrl: string;
  token: string;
  snapshot: CapturedTabSnapshot;
}): Promise<BrowserImportResponse> {
  let response: Response;
  try {
    response = await fetch(`${input.traumaUrl}/api/browser-import`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.snapshot),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach TRAUMA: ${formatUnknownError(error)}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: readErrorBody(body) ?? `TRAUMA returned HTTP ${response.status}.`,
    };
  }

  const result = readSuccessBody(body);
  if (result === null) {
    return { ok: false, error: "TRAUMA returned an invalid response." };
  }

  return { ok: true, result };
}

function readSuccessBody(value: unknown): BrowserImportSuccess | null {
  if (!isRecord(value) || !isRecord(value.memory)) {
    return null;
  }

  if (typeof value.memory.id !== "string" || typeof value.url !== "string") {
    return null;
  }

  return {
    memory: {
      id: value.memory.id,
    },
    url: value.url,
  };
}

function readErrorBody(value: unknown) {
  return isRecord(value) && typeof value.error === "string" ? value.error : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
