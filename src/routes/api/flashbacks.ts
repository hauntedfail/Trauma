import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue } from "~/server/backup";
import { BackupEnvironmentFailsafeError } from "~/server/backup/environment";
import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import {
  FlashbackToggleError,
  toggleMemoryFlashback,
  type FlashbackToggleOperation,
  type ToggleMemoryFlashbackResult,
} from "~/server/flashbacks/toggle";
import {
  MemoryContentStoreError,
  readMemoryContent,
  readResolvedMemoryContent,
} from "~/server/store";
import type { FlashbackSelectionInput } from "~/server/store/flashback-markers";
import { createReaderContentHash } from "~/server/store/flashback-markers";
import {
  projectFlashbacksToTranslatedReader,
  projectTranslatedSelectionToSourceReader,
} from "~/server/reader/translation-projections";
import { resolveCurrentTranslationReadOnly } from "~/server/translation/current-translation";
import {
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from "~/server/translation/languages";
import { resolveTranslatedMemoryContentPath } from "~/server/translation/paths";

type FlashbackTogglePayloadResult =
  | {
    ok: true;
    langCode?: SupportedLanguageCode;
    memoryId: string;
    operation: FlashbackToggleOperation;
    selection: FlashbackSelectionInput;
  }
  | { ok: false; error: string };

const SELECTION_KEYS = [
  "text",
  "prefix",
  "suffix",
  "startOffset",
  "endOffset",
] as const;

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseFlashbackTogglePayloadInternal(event.request);
  if (!payload.ok) {
    return json({ error: payload.error }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const translatedProjection = payload.langCode === undefined
      ? undefined
      : await resolveTranslatedFlashbackProjection({
        config,
        connection,
        langCode: payload.langCode,
        memoryId: payload.memoryId,
        selection: payload.selection,
      });
    const result = await toggleMemoryFlashback({
      memoryId: payload.memoryId,
      operation: payload.operation,
      selection: translatedProjection?.sourceSelection ?? payload.selection,
      config,
      db: connection.db,
      backupQueue: getMemoryBackupQueue(config),
    });

    return json({
      result: translatedProjection === undefined
        ? result
        : projectToggleResultToTranslatedFlashbacks(result, translatedProjection),
    }, { status: 200 });
  } catch (error) {
    return formatToggleError(error);
  } finally {
    connection.close();
  }
}

async function resolveTranslatedFlashbackProjection(input: {
  config: ReturnType<typeof loadRuntimeTraumaConfig>;
  connection: ReturnType<typeof initializeDatabase>;
  langCode: SupportedLanguageCode;
  memoryId: string;
  selection: FlashbackSelectionInput;
}) {
  const current = await resolveCurrentTranslationReadOnly({
    config: input.config,
    langCode: input.langCode,
    memoryId: input.memoryId,
    repository: input.connection.repositories.translations,
  });
  if (current.status !== "current") {
    throw new FlashbackToggleError(
      "Translated flashback selection is unavailable.",
      "invalid_selection",
    );
  }

  const sourceContent = await readMemoryContent({
    config: input.config,
    memoryId: input.memoryId,
  });
  const translatedContent = await readResolvedMemoryContent(
    resolveTranslatedMemoryContentPath({
      config: input.config,
      langCode: input.langCode,
      memoryId: input.memoryId,
    }),
  );
  const projectionSpans =
    await input.connection.repositories.translations.listCurrentProjectionSpans({
      langCode: input.langCode,
      memoryId: input.memoryId,
      outputHash: current.outputHash,
      sourceHash: current.sourceHash,
    });
  const sourceSelection = projectTranslatedSelectionToSourceReader({
    projectionSpans,
    selection: input.selection,
    sourceMarkdown: sourceContent.markdown,
    translatedMarkdown: translatedContent.markdown,
  });
  if (sourceSelection === undefined) {
    throw new FlashbackToggleError(
      "Translated flashback selection could not be projected to source.",
      "invalid_selection",
    );
  }

  return {
    projectionSpans,
    sourceContentHash: createReaderContentHash(sourceContent.markdown),
    sourceSelection,
    translatedMarkdown: translatedContent.markdown,
  };
}

function projectToggleResultToTranslatedFlashbacks(
  result: ToggleMemoryFlashbackResult,
  projection: Awaited<ReturnType<typeof resolveTranslatedFlashbackProjection>>,
): ToggleMemoryFlashbackResult {
  const projected = projectFlashbacksToTranslatedReader({
    flashbacks: result.flashbacks.map((flashback) => ({
      ...flashback,
      createdAt: new Date(flashback.createdAt),
    })),
    projectionSpans: projection.projectionSpans,
    sourceContentHash: projection.sourceContentHash,
    translatedMarkdown: projection.translatedMarkdown,
  });
  return {
    ...result,
    flashbacks: projected.items.map((flashback) => ({
      contentHash: flashback.contentHash ?? "",
      createdAt: flashback.createdAt,
      endOffset: flashback.endOffset,
      id: flashback.id,
      prefix: flashback.prefix,
      startOffset: flashback.startOffset,
      suffix: flashback.suffix,
      text: flashback.text,
    })),
  };
}

export const parseFlashbackTogglePayload = parseFlashbackTogglePayloadInternal;

async function parseFlashbackTogglePayloadInternal(
  request: Request,
): Promise<FlashbackTogglePayloadResult> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (!hasOnlyKeys(payload, ["memoryId", "langCode", "operation", "selection"])) {
    return {
      ok: false,
      error: "request body must contain only memoryId, langCode, operation, and selection",
    };
  }

  if (typeof payload.memoryId !== "string" || payload.memoryId.trim() === "") {
    return { ok: false, error: "memoryId must be a non-empty string" };
  }

  if (
    payload.langCode !== undefined &&
    (
      typeof payload.langCode !== "string" ||
      !isSupportedLanguageCode(payload.langCode)
    )
  ) {
    return { ok: false, error: "langCode must be a supported translation language" };
  }

  if (!isFlashbackToggleOperation(payload.operation)) {
    return {
      ok: false,
      error: "operation must be flashback or unflashback",
    };
  }

  const selection = parseSelection(payload.selection);
  if (!selection.ok) {
    return selection;
  }

  return {
    ok: true,
    ...(payload.langCode === undefined ? {} : { langCode: payload.langCode }),
    memoryId: payload.memoryId.trim(),
    operation: payload.operation,
    selection: selection.selection,
  };
}

function parseSelection(
  value: unknown,
): { ok: true; selection: FlashbackSelectionInput } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "selection must be an object" };
  }

  if (!hasOnlyKeys(value, SELECTION_KEYS)) {
    return {
      ok: false,
      error:
        "selection must contain only text, prefix, suffix, startOffset, and endOffset",
    };
  }

  if (typeof value.text !== "string" || value.text.length === 0) {
    return { ok: false, error: "selection.text must be a non-empty string" };
  }

  if (typeof value.prefix !== "string") {
    return { ok: false, error: "selection.prefix must be a string" };
  }

  if (typeof value.suffix !== "string") {
    return { ok: false, error: "selection.suffix must be a string" };
  }

  if (
    typeof value.startOffset !== "number" ||
    typeof value.endOffset !== "number" ||
    !Number.isInteger(value.startOffset) ||
    !Number.isInteger(value.endOffset) ||
    value.startOffset < 0 ||
    value.endOffset <= value.startOffset
  ) {
    return {
      ok: false,
      error: "selection offsets must describe a non-empty range",
    };
  }

  return {
    ok: true,
    selection: {
      text: value.text,
      prefix: value.prefix,
      suffix: value.suffix,
      startOffset: value.startOffset,
      endOffset: value.endOffset,
    },
  };
}

function formatToggleError(error: unknown): Response {
  if (error instanceof FlashbackToggleError) {
    return json(
      { error: error.message },
      {
        status: error.code === "missing_memory"
          ? 404
          : error.code === "stale_selection"
            ? 409
            : 400,
      },
    );
  }

  if (error instanceof MemoryContentStoreError) {
    return json(
      { error: "flashback content is unavailable" },
      { status: error.code === "missing_content" ? 404 : 400 },
    );
  }

  if (error instanceof BackupEnvironmentFailsafeError) {
    return json(
      {
        error: error.message,
        backupFailsafe: error.alert ?? null,
      },
      { status: 409 },
    );
  }

  return json({ error: "failed to toggle flashback" }, { status: 500 });
}

function json(
  body:
    | { error: string }
    | { error: string; backupFailsafe: unknown }
    | { result: ToggleMemoryFlashbackResult },
  init: ResponseInit,
) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  return keys.every((key) => expected.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlashbackToggleOperation(
  value: unknown,
): value is FlashbackToggleOperation {
  return value === "flashback" || value === "unflashback";
}

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
