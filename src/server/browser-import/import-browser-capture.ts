import { isIP } from "node:net";

import type { MemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import type { ImporterResult } from "../importer";
import {
  extractArticleWithDefuddle,
  readableMarkdownLength,
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

  let extracted: Awaited<ReturnType<typeof extractArticleWithDefuddle>>;
  try {
    extracted = await withTimeout(
      (input.extractArticle ?? extractArticleWithDefuddle)({
        html: createExtractionDocumentHtml(input.payload),
        pageUrl: selectedUrl,
      }),
      input.extractionTimeoutMs ?? DEFAULT_BROWSER_IMPORT_EXTRACTION_TIMEOUT_MS,
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

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
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
}
