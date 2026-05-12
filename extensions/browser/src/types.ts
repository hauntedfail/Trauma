export interface ExtensionSettings {
  traumaUrl: string;
  token: string;
}

export interface CapturedTabSnapshot {
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  articleHtml: string;
  articleText: string;
  selector: string;
  extractionStrategy: ExtractionStrategy;
  capturedAt: string;
  extensionVersion: string;
}

export type ExtractionStrategy =
  | "site_selector"
  | "semantic_selector"
  | "body_fallback";

export type CaptureResult =
  | { ok: true; snapshot: CapturedTabSnapshot }
  | { ok: false; error: string };

export interface BrowserImportSuccess {
  memory: {
    id: string;
  };
  url: string;
}

export type BrowserImportResponse =
  | { ok: true; result: BrowserImportSuccess }
  | { ok: false; error: string };

export type RuntimeMessage =
  | {
      type: "IMPORT_CURRENT_TAB";
      settings: ExtensionSettings;
    };

export interface ChromeTab {
  id?: number;
  url?: string;
  title?: string;
}

export interface ChromeApi {
  runtime: {
    getManifest: () => { version: string };
    onMessage: {
      addListener: (
        listener: (
          message: RuntimeMessage,
          sender: unknown,
          sendResponse: (response: BrowserImportResponse) => void,
        ) => true | undefined,
      ) => void;
    };
    sendMessage: (
      message: RuntimeMessage,
      callback: (response: BrowserImportResponse) => void,
    ) => void;
    lastError?: {
      message?: string;
    };
  };
  storage: {
    local: {
      get: (keys: readonly string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  tabs: {
    query: (queryInfo: {
      active: boolean;
      currentWindow: boolean;
    }) => Promise<ChromeTab[]>;
    create: (createProperties: { url: string }) => Promise<ChromeTab>;
  };
  scripting: {
    executeScript: <T>(details: {
      target: { tabId: number };
      files: readonly string[];
    }) => Promise<Array<{ result?: T }>>;
  };
}

declare global {
  const chrome: ChromeApi;
}
