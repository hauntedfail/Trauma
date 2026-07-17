import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue } from "~/server/backup";
import { BackupEnvironmentFailsafeError } from "~/server/backup/environment";
import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { readJsonMutationRequest } from "~/server/http/mutation-request";
import { validateImportUrl } from "~/server/importer";
import { createRuntimeMemoryImporter } from "~/server/importer/runtime";
import {
  AddMemoryIdempotencyConflictError,
  AddMemoryIdempotencyReplayError,
  addMemory,
} from "~/server/memories/add-memory";
import { isMemoryId } from "~/server/memories/id";

export async function POST(event: APIEvent): Promise<Response> {
  const idempotencyKey = readAddMemoryIdempotencyKey(event.request);
  if (!idempotencyKey.ok) {
    return json({ error: idempotencyKey.error }, { status: 400 });
  }
  const importer = createRuntimeMemoryImporter();
  const payload = await parseAddMemoryPayloadInternal(event.request, {
    validateUrl: importer.validateUrl,
  });
  if (!payload.ok) {
    return json({ error: payload.error }, { status: payload.status ?? 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const memory = await addMemory({
      url: payload.url,
      config,
      db: connection.db,
      backupQueue: getMemoryBackupQueue(config),
      importer,
      ...(idempotencyKey.value === undefined
        ? {}
        : { idempotencyKey: idempotencyKey.value }),
    });

    return json({ memory }, { status: 201 });
  } catch (error) {
    if (
      error instanceof AddMemoryIdempotencyConflictError ||
      error instanceof AddMemoryIdempotencyReplayError
    ) {
      return json({ error: error.message }, { status: 409 });
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

    throw error;
  } finally {
    connection.close();
  }
}

type AddMemoryPayloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status?: number };

interface ParseAddMemoryPayloadOptions {
  validateUrl?: (url: string) => Promise<string>;
  validationTimeoutMs?: number;
}

const DEFAULT_ROUTE_URL_VALIDATION_TIMEOUT_MS = 10_000;

function readAddMemoryIdempotencyKey(
  request: Request,
):
  | { ok: true; value: string | undefined }
  | { ok: false; error: string } {
  const value = request.headers.get("idempotency-key");
  if (value === null) {
    return { ok: true, value: undefined };
  }
  if (!isMemoryId(value)) {
    return { ok: false, error: "Idempotency-Key must be a UUID v7" };
  }
  return { ok: true, value };
}

export const parseAddMemoryPayload = parseAddMemoryPayloadInternal;

async function parseAddMemoryPayloadInternal(
  request: Request,
  options: ParseAddMemoryPayloadOptions = {},
): Promise<AddMemoryPayloadResult> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }
  const payload = body.payload;

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "url") {
    return { ok: false, error: "request body must contain only url" };
  }

  if (typeof payload.url !== "string") {
    return { ok: false, error: "url must be a non-empty string" };
  }

  const url = payload.url.trim();
  if (url === "") {
    return { ok: false, error: "url must be a non-empty string" };
  }

  try {
    return {
      ok: true,
      url: await validateUrlWithinTimeout(url, {
        validateUrl: options.validateUrl ?? validateImportUrl,
        timeoutMs:
          options.validationTimeoutMs ??
          DEFAULT_ROUTE_URL_VALIDATION_TIMEOUT_MS,
      }),
    };
  } catch (error) {
    if (isUrlValidationTimeout(error)) {
      return { ok: false, error: "url validation timed out" };
    }

    return { ok: false, error: "url must be a valid absolute URL" };
  }
}

async function validateUrlWithinTimeout(
  url: string,
  input: { validateUrl: (url: string) => Promise<string>; timeoutMs: number },
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.validateUrl(url),
      new Promise<string>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new UrlValidationTimeoutError());
        }, input.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function json(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigError(error: unknown) {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}

class UrlValidationTimeoutError extends Error {}

function isUrlValidationTimeout(error: unknown) {
  return error instanceof UrlValidationTimeoutError;
}
