import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import {
  startTranslationJob,
  TranslationApiError,
} from "~/server/translation/runner";

type StartTranslationJob = typeof startTranslationJob;

type StartTranslationPayload =
  | { ok: true; langCode?: string }
  | { ok: false; error: string };

export function createStartTranslationHandler(input: {
  startTranslationJob: StartTranslationJob;
}) {
  return async function handleStartTranslation(event: APIEvent): Promise<Response> {
    const memoryId = event.params.memoryId?.trim();
    if (memoryId === undefined || memoryId === "") {
      return jsonResponse(
        { error: "memoryId must be a non-empty string" },
        { status: 400 },
      );
    }

    const payload = await parseStartTranslationPayload(event.request);
    if (!payload.ok) {
      return jsonResponse({ error: payload.error }, { status: 400 });
    }

    try {
      const result = await input.startTranslationJob({
        langCode: payload.langCode,
        memoryId,
      });
      return jsonResponse(result, {
        status: result.status === "started" ? 202 : 200,
      });
    } catch (error) {
      return formatStartTranslationError(error);
    }
  };
}

export const POST = createStartTranslationHandler({ startTranslationJob });

export async function parseStartTranslationPayload(
  request: Request,
): Promise<StartTranslationPayload> {
  const rawBody = await request.text();
  if (rawBody.trim() === "") {
    return { ok: true };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return { ok: true };
  }
  if (!hasOnlyKeys(payload, ["lang_code"])) {
    return { ok: false, error: "request body must contain only lang_code" };
  }
  if (
    typeof payload.lang_code !== "string" ||
    payload.lang_code.trim() === ""
  ) {
    return { ok: false, error: "lang_code must be a non-empty string" };
  }

  return { ok: true, langCode: payload.lang_code.trim() };
}

function formatStartTranslationError(error: unknown): Response {
  if (error instanceof TranslationApiError) {
    return jsonResponse(
      {
        action: error.action,
        code: error.code,
        message: error.message,
        status: "error",
      },
      { status: statusForTranslationError(error) },
    );
  }

  return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
}

function statusForTranslationError(error: TranslationApiError): number {
  switch (error.code) {
    case "missing_memory":
    case "missing_source_content":
      return 404;
    case "invalid_language":
      return 400;
    case "translation_language_required":
    case "translation_language_mismatch":
    case "cancellation_conflict":
      return 409;
    case "auth_required":
    case "setup_required":
    case "translation_unavailable":
    case "stale_source":
    case "usage_limit":
    case "context_overflow":
    case "validation_failed":
      return 409;
    case "app_server_unavailable":
    case "stream_disconnected":
      return 503;
    case "timeout":
      return 504;
    case "invalid_final_output":
      return 502;
    case "filesystem_failure":
    case "unknown":
      return 500;
    default:
      return 500;
  }
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
