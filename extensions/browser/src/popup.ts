import {
  DEFAULT_TRAUMA_URL,
  loadSettings,
  normalizeTraumaUrl,
  saveSettings,
} from "./settings";
import type { BrowserImportResponse, ExtensionSettings } from "./types";

let settings: ExtensionSettings = {
  traumaUrl: DEFAULT_TRAUMA_URL,
  token: "",
};

void initializePopup();

async function initializePopup() {
  settings = await loadSettings();
  bindNavigation();
  bindSettingsForm();
  bindImportActions();
  renderSettings();
  await renderCurrentTab();
}

function bindNavigation() {
  const importButton = requireElement<HTMLButtonElement>("nav-import");
  const settingsButton = requireElement<HTMLButtonElement>("nav-settings");

  importButton.addEventListener("click", () => showView("import"));
  settingsButton.addEventListener("click", () => showView("settings"));
}

function bindSettingsForm() {
  requireElement<HTMLButtonElement>("save-settings-button").addEventListener(
    "click",
    async () => {
      const traumaUrl = requireElement<HTMLInputElement>("trauma-url").value;
      const token = requireElement<HTMLInputElement>("token").value;

      try {
        await saveSettings({ traumaUrl, token });
        const normalizedUrl = normalizeTraumaUrl(traumaUrl);
        if (!normalizedUrl.ok) {
          throw new Error(normalizedUrl.error);
        }
        settings = { traumaUrl: normalizedUrl.value, token };
        setStatus("settings-status", "Settings saved.", "success");
      } catch (error) {
        setStatus("settings-status", formatUnknownError(error), "error");
      }
    },
  );
}

function bindImportActions() {
  requireElement<HTMLButtonElement>("import-button").addEventListener(
    "click",
    async () => {
      const importButton = requireElement<HTMLButtonElement>("import-button");
      importButton.disabled = true;
      setStatus("import-status", "Importing current page...", "info");

      try {
        const response = await sendImportMessage(settings);
        if (!response.ok) {
          setStatus("import-status", response.error, "error");
          return;
        }

        setStatus("import-status", "Memory created.", "success");
        const target = new URL(response.result.url, settings.traumaUrl).toString();
        await chrome.tabs.create({ url: target });
      } finally {
        importButton.disabled = false;
      }
    },
  );

  requireElement<HTMLButtonElement>("open-trauma-button").addEventListener(
    "click",
    async () => {
      await chrome.tabs.create({ url: settings.traumaUrl });
    },
  );
}

function renderSettings() {
  requireElement<HTMLInputElement>("trauma-url").value = settings.traumaUrl;
  requireElement<HTMLInputElement>("token").value = settings.token;
}

async function renderCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  requireElement("current-url").textContent = tab?.url ?? "No active tab found.";
}

function showView(view: "import" | "settings") {
  requireElement("view-import").hidden = view !== "import";
  requireElement("view-settings").hidden = view !== "settings";
  requireElement("nav-import").setAttribute(
    "aria-current",
    view === "import" ? "page" : "false",
  );
  requireElement("nav-settings").setAttribute(
    "aria-current",
    view === "settings" ? "page" : "false",
  );
}

function sendImportMessage(settingsInput: ExtensionSettings) {
  return new Promise<BrowserImportResponse>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "IMPORT_CURRENT_TAB", settings: settingsInput },
      (response) => {
        if (chrome.runtime.lastError !== undefined) {
          resolve({
            ok: false,
            error:
              chrome.runtime.lastError.message ??
              "Could not communicate with the TRAUMA extension worker.",
          });
          return;
        }

        resolve(response);
      },
    );
  });
}

function setStatus(
  id: string,
  message: string,
  kind: "info" | "success" | "error",
) {
  const element = requireElement(id);
  element.textContent = message;
  element.dataset.kind = kind;
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing popup element: ${id}`);
  }

  return element as T;
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
