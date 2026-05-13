import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type { MemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import type { ImporterResult } from "../importer";
import {
  readableMarkdownLength,
  type ExtractedArticle,
  type ArticleExtractor,
} from "../importer/extractor";
import { isBlockedHostname, normalizeHostname } from "../importer/host-policy";
import { addMemory } from "../memories/add-memory";
import type { AddMemoryInput } from "../memories/add-memory";
import type { BrowserImportPayload } from "./payload";

export class BrowserImportError extends Error {
  readonly status: number;
  override name = "BrowserImportError";

  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

export interface ImportBrowserCaptureInput {
  payload: BrowserImportPayload;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  backupQueue: MemoryBackupQueue;
  extractArticle?: ArticleExtractor;
  extractionTimeoutMs?: number;
  createMemory?: (input: AddMemoryInput) => Promise<{ id: string }>;
}

const MINIMUM_READABLE_BODY_LENGTH = 80;
const DEFAULT_BROWSER_IMPORT_EXTRACTION_TIMEOUT_MS = 10_000;

export async function importBrowserCapture(input: ImportBrowserCaptureInput) {
  const selectedUrl = selectCaptureUrl(input.payload);
  if (readableMarkdownLength(input.payload.articleText) < MINIMUM_READABLE_BODY_LENGTH) {
    throw new BrowserImportError("extracted page content is too short");
  }

  const extractionInput = {
    html: createExtractionDocumentHtml(input.payload),
    pageUrl: selectedUrl,
  };
  const extractionTimeoutMs =
    input.extractionTimeoutMs ?? DEFAULT_BROWSER_IMPORT_EXTRACTION_TIMEOUT_MS;
  let extracted: ExtractedArticle;
  try {
    extracted =
      input.extractArticle === undefined
        ? await extractArticleInWorker(extractionInput, extractionTimeoutMs)
        : await runExtractorWithTimeout(
            () => input.extractArticle!(extractionInput),
            extractionTimeoutMs,
          );
  } catch {
    throw new BrowserImportError("failed to extract readable page content");
  }

  if (readableMarkdownLength(extracted.markdown) < MINIMUM_READABLE_BODY_LENGTH) {
    throw new BrowserImportError("extracted page content is too short");
  }

  const title =
    extracted.title ||
    input.payload.title ||
    fallbackTitleFromUrl(selectedUrl);
  const imported: ImporterResult = {
    status: "success",
    url: selectedUrl,
    title,
    description: extracted.description ?? input.payload.description,
    faviconUrl: extracted.faviconUrl,
    markdown: extracted.markdown,
  };

  const createMemory = input.createMemory ?? addMemory;
  return createMemory({
    url: selectedUrl,
    config: input.config,
    db: input.db,
    backupQueue: input.backupQueue,
    importer: {
      importUrl: async () => imported,
    },
  });
}

function selectCaptureUrl(payload: BrowserImportPayload) {
  const sourceUrl = normalizeCaptureUrl(payload.sourceUrl);
  if (sourceUrl === null) {
    throw new BrowserImportError("source URL is not allowed");
  }

  if (payload.canonicalUrl === null) {
    return sourceUrl.toString();
  }

  const canonicalUrl = normalizeCaptureUrl(payload.canonicalUrl);
  if (
    canonicalUrl === null ||
    !isTrustedCanonicalHostname(sourceUrl, canonicalUrl.hostname)
  ) {
    return sourceUrl.toString();
  }

  return canonicalUrl.toString();
}

function normalizeCaptureUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (isBlockedHostname(url.hostname)) {
      return null;
    }

    url.username = "";
    url.password = "";
    return url;
  } catch {
    return null;
  }
}

function isTrustedCanonicalHostname(sourceUrl: URL, hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  if (normalizedHostname === normalizeHostname(sourceUrl.hostname)) {
    return true;
  }

  return isIP(normalizedHostname) !== 0;
}

function fallbackTitleFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function createExtractionDocumentHtml(payload: BrowserImportPayload) {
  return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(payload.title ?? "")}</title>
    ${payload.description === null ? "" : `<meta name="description" content="${escapeHtml(payload.description)}">`}
  </head>
  <body>
    ${payload.articleHtml}
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function runExtractorWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const operationPromise = operation();
    return Promise.race([
      operationPromise.then((result) => {
        if (Date.now() > deadline) {
          throw new Error("browser import extraction timed out");
        }

        return result;
      }),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("browser import extraction timed out"));
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    if (Date.now() > deadline) {
      throw new Error("browser import extraction timed out");
    }

    throw error;
  }
}

function extractArticleInWorker(
  input: { html: string; pageUrl: string },
  timeoutMs: number,
): Promise<ExtractedArticle> {
  return new Promise((resolveArticle, rejectArticle) => {
    const worker = new Worker(createExtractorWorkerSource(), {
      eval: true,
      workerData: input,
    });
    let settled = false;
    const timeout = setTimeout(() => {
      settle(() => rejectArticle(new Error("browser import extraction timed out")));
      void worker.terminate();
    }, timeoutMs);

    const settle = (finish: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      finish();
    };

    worker.once("message", (message: unknown) => {
      settle(() => {
        const parsed = parseExtractorWorkerMessage(message);
        if (!parsed.ok) {
          rejectArticle(new Error(parsed.error));
          return;
        }

        resolveArticle(parsed.article);
      });
    });
    worker.once("error", (error) => {
      settle(() => rejectArticle(error));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle(() =>
          rejectArticle(new Error(`browser import extractor exited with ${code}`)),
        );
      }
    });
  });
}

function createExtractorWorkerSource() {
  const extractorModuleUrl = resolveExtractorModuleUrl();
  return `
    import { parentPort, workerData } from "node:worker_threads";

    try {
      const { extractArticleWithDefuddle } = await import(${JSON.stringify(
        extractorModuleUrl,
      )});
      const article = await extractArticleWithDefuddle(workerData);
      parentPort.postMessage({ ok: true, article });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  `;
}

function resolveExtractorModuleUrl() {
  const adjacentSourceUrl = new URL("../importer/extractor.ts", import.meta.url);
  if (existsSync(fileURLToPath(adjacentSourceUrl))) {
    return adjacentSourceUrl.href;
  }

  return pathToFileURL(
    resolve(process.cwd(), "src/server/importer/extractor.ts"),
  ).href;
}

function parseExtractorWorkerMessage(
  message: unknown,
):
  | { ok: true; article: ExtractedArticle }
  | { ok: false; error: string } {
  if (!isRecord(message)) {
    return { ok: false, error: "extractor worker returned invalid output" };
  }

  if (message.ok === false) {
    return {
      ok: false,
      error:
        typeof message.error === "string"
          ? message.error
          : "extractor worker failed",
    };
  }

  if (message.ok === true && isExtractedArticle(message.article)) {
    return { ok: true, article: message.article };
  }

  return { ok: false, error: "extractor worker returned invalid article" };
}

function isExtractedArticle(value: unknown): value is ExtractedArticle {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    (typeof value.description === "string" || value.description === null) &&
    (typeof value.faviconUrl === "string" || value.faviconUrl === null) &&
    typeof value.markdown === "string" &&
    (typeof value.wordCount === "number" || value.wordCount === null)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
