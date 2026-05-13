import { Worker } from "node:worker_threads";

import {
  extractArticleWithDefuddle,
  type ArticleExtractor,
  type ExtractArticleInput,
  type ExtractedArticle,
} from "./extractor";

const EXTRACTOR_RUNTIME_KEY = "__TRAUMA_ARTICLE_EXTRACTOR_RUNTIME__";

interface ExtractorRuntimeGlobal {
  __TRAUMA_ARTICLE_EXTRACTOR_RUNTIME__?: {
    extractArticle(input: ExtractArticleInput): Promise<ExtractedArticle>;
  };
}

export class ArticleExtractionTimeoutError extends Error {
  override name = "ArticleExtractionTimeoutError";

  constructor() {
    super("article extraction timed out");
  }
}

export function isArticleExtractionTimeout(
  error: unknown,
): error is ArticleExtractionTimeoutError {
  return error instanceof ArticleExtractionTimeoutError;
}

export function runExtractorWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) {
    return Promise.reject(new ArticleExtractionTimeoutError());
  }

  const deadline = Date.now() + timeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const operationPromise = operation();
    return Promise.race([
      operationPromise.then((result) => {
        if (Date.now() > deadline) {
          throw new ArticleExtractionTimeoutError();
        }

        return result;
      }),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new ArticleExtractionTimeoutError());
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    if (Date.now() > deadline) {
      throw new ArticleExtractionTimeoutError();
    }

    throw error;
  }
}

export function extractArticleInWorker(
  input: ExtractArticleInput,
  timeoutMs: number,
): Promise<ExtractedArticle> {
  if (timeoutMs <= 0) {
    return Promise.reject(new ArticleExtractionTimeoutError());
  }

  return new Promise((resolveArticle, rejectArticle) => {
    const worker = new Worker(createExtractorWorkerSource(), {
      eval: true,
      workerData: input,
    });
    worker.unref();
    let settled = false;
    const timeout = setTimeout(() => {
      settle(() => rejectArticle(new ArticleExtractionTimeoutError()), true);
    }, timeoutMs);

    const settle = (finish: () => void, terminateWorker: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (!terminateWorker) {
        finish();
        return;
      }

      void worker.terminate().finally(finish);
    };

    worker.once("message", (message: unknown) => {
      settle(() => {
        const parsed = parseExtractorWorkerMessage(message);
        if (!parsed.ok) {
          rejectArticle(new Error(parsed.error));
          return;
        }

        resolveArticle(parsed.article);
      }, true);
    });
    worker.once("error", (error) => {
      settle(() => rejectArticle(error), false);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        settle(
          () =>
            rejectArticle(new Error(`article extractor exited with ${code}`)),
          false,
        );
      }
    });
  });
}

export function createExtractorWorkerSource(workerModuleUrl = import.meta.url) {
  return `
    import { parentPort, workerData } from "node:worker_threads";

    try {
      await import(${JSON.stringify(workerModuleUrl)});
      const runtime = globalThis[${JSON.stringify(EXTRACTOR_RUNTIME_KEY)}];
      if (runtime === undefined || typeof runtime.extractArticle !== "function") {
        throw new Error("article extractor runtime is unavailable");
      }

      const article = await runtime.extractArticle(workerData);
      parentPort.postMessage({ ok: true, article });
      parentPort.close();
      process.exit(0);
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      parentPort.close();
      process.exit(0);
    }
  `;
}

export const defaultArticleExtractor: ArticleExtractor = extractArticleWithDefuddle;

async function runExtractorWorkerPayload(
  input: ExtractArticleInput,
): Promise<ExtractedArticle> {
  return defaultArticleExtractor(input);
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

const runtimeGlobal = globalThis as typeof globalThis & ExtractorRuntimeGlobal;
runtimeGlobal.__TRAUMA_ARTICLE_EXTRACTOR_RUNTIME__ = {
  extractArticle: runExtractorWorkerPayload,
};
