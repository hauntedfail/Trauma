import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { readJsonMutationRequest } from "~/server/http/mutation-request";
import {
  UnsupportedTranslationLanguageError,
  updateTranslationTargetLanguage,
} from "~/server/settings/settings";

type TranslationLanguagePayload =
  | { ok: true; language: string }
  | { ok: false; error: string; status?: number };

export async function PATCH(event: APIEvent): Promise<Response> {
  const payload = await parseTranslationLanguagePayload(event.request);
  if (!payload.ok) {
    return jsonResponse(
      { error: payload.error },
      { status: payload.status ?? 400 },
    );
  }

  try {
    return jsonResponse(
      await updateTranslationTargetLanguage(payload.language),
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof UnsupportedTranslationLanguageError) {
      return jsonResponse(
        { error: "unsupported translation target language" },
        { status: 400 },
      );
    }

    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}

async function parseTranslationLanguagePayload(
  request: Request,
): Promise<TranslationLanguagePayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }
  const payload = body.payload;

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (!hasOnlyKeys(payload, ["language"])) {
    return { ok: false, error: "request body must contain only language" };
  }

  if (typeof payload.language !== "string" || payload.language.trim() === "") {
    return { ok: false, error: "language must be a non-empty string" };
  }

  return { ok: true, language: payload.language.trim() };
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
