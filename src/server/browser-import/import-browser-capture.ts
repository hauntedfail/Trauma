import type { MemoryBackupQueue } from "../backup";
import type { ResolvedTraumaConfig } from "../config";
import type { TraumaDatabase } from "../db";
import type { ImporterResult } from "../importer";
import {
  extractArticleWithDefuddle,
  readableMarkdownLength,
} from "../importer/extractor";
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
  createMemory?: (input: AddMemoryInput) => Promise<{ id: string }>;
}

const MINIMUM_READABLE_BODY_LENGTH = 80;

export async function importBrowserCapture(input: ImportBrowserCaptureInput) {
  const selectedUrl = input.payload.canonicalUrl ?? input.payload.sourceUrl;
  let extracted: Awaited<ReturnType<typeof extractArticleWithDefuddle>>;
  try {
    extracted = await extractArticleWithDefuddle({
      html: input.payload.html,
      pageUrl: selectedUrl,
    });
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

function fallbackTitleFromUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
