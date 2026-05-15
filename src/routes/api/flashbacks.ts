import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase, MemoryRepositoryError } from "~/server/db";
import { generateFlashbackId } from "~/server/flashbacks/id";

export type FlashbackPayloadResult =
  | {
      ok: true;
      memoryId: string;
      sectionAnchor: string;
      sectionTitle: string;
      sectionLevel: number;
      sectionPath: string;
      sectionStartOffset: number | null;
      sectionEndOffset: number | null;
      contentHash: string | null;
    }
  | { ok: false; error: string };

const FLASHBACK_KEYS = [
  "memoryId",
  "sectionAnchor",
  "sectionTitle",
  "sectionLevel",
  "sectionPath",
  "sectionStartOffset",
  "sectionEndOffset",
  "contentHash",
] as const;

const REQUIRED_FLASHBACK_KEYS = [
  "memoryId",
  "sectionAnchor",
  "sectionTitle",
  "sectionLevel",
  "sectionPath",
] as const;

export async function GET(): Promise<Response> {
  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    return json(
      { flashbacks: await connection.repositories.flashbacks.listForBrowse() },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseFlashbackPayload(event.request);
  if (!payload.ok) {
    return json({ error: payload.error }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const now = new Date();
  const connection = initializeDatabase(config);
  try {
    const result = await connection.repositories.flashbacks.create({
      id: generateFlashbackId(),
      memoryId: payload.memoryId,
      sectionAnchor: payload.sectionAnchor,
      sectionTitle: payload.sectionTitle,
      sectionLevel: payload.sectionLevel,
      sectionPath: payload.sectionPath,
      sectionStartOffset: payload.sectionStartOffset,
      sectionEndOffset: payload.sectionEndOffset,
      contentHash: payload.contentHash,
      createdAt: now,
      updatedAt: now,
    });

    return json(
      {
        alreadyExists: result.alreadyExists,
        flashback: formatFlashback(result.flashback),
      },
      { status: result.alreadyExists ? 200 : 201 },
    );
  } catch (error) {
    return formatFlashbackError(error);
  } finally {
    connection.close();
  }
}

export async function parseFlashbackPayload(
  request: Request,
): Promise<FlashbackPayloadResult> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (!hasOnlyAllowedKeys(payload, FLASHBACK_KEYS)) {
    return {
      ok: false,
      error:
        "request body must contain only memoryId, sectionAnchor, sectionTitle, sectionLevel, sectionPath, sectionStartOffset, sectionEndOffset, and contentHash",
    };
  }

  if (!hasRequiredKeys(payload, REQUIRED_FLASHBACK_KEYS)) {
    return {
      ok: false,
      error:
        "request body must contain memoryId, sectionAnchor, sectionTitle, sectionLevel, and sectionPath",
    };
  }

  const memoryId = parseNonEmptyString(payload.memoryId, "memoryId");
  if (!memoryId.ok) {
    return memoryId;
  }

  const sectionAnchor = parseNonEmptyString(
    normalizeAnchorPayload(payload.sectionAnchor),
    "sectionAnchor",
  );
  if (!sectionAnchor.ok) {
    return sectionAnchor;
  }

  const sectionTitle = parseNonEmptyString(
    payload.sectionTitle,
    "sectionTitle",
  );
  if (!sectionTitle.ok) {
    return sectionTitle;
  }

  if (
    typeof payload.sectionLevel !== "number" ||
    !Number.isInteger(payload.sectionLevel) ||
    payload.sectionLevel < 1 ||
    payload.sectionLevel > 6
  ) {
    return {
      ok: false,
      error: "sectionLevel must be an integer from 1 to 6",
    };
  }

  const sectionPath = parseNonEmptyString(payload.sectionPath, "sectionPath");
  if (!sectionPath.ok) {
    return sectionPath;
  }

  const offsets = parseOffsets(payload);
  if (!offsets.ok) {
    return offsets;
  }

  const contentHash = parseNullableString(payload.contentHash, "contentHash");
  if (!contentHash.ok) {
    return contentHash;
  }

  return {
    ok: true,
    memoryId: memoryId.value,
    sectionAnchor: sectionAnchor.value,
    sectionTitle: sectionTitle.value,
    sectionLevel: payload.sectionLevel,
    sectionPath: sectionPath.value,
    sectionStartOffset: offsets.sectionStartOffset,
    sectionEndOffset: offsets.sectionEndOffset,
    contentHash: contentHash.value,
  };
}

function parseOffsets(
  payload: Record<string, unknown>,
):
  | { ok: true; sectionStartOffset: number | null; sectionEndOffset: number | null }
  | { ok: false; error: string } {
  const start = payload.sectionStartOffset ?? null;
  const end = payload.sectionEndOffset ?? null;
  if (start === null && end === null) {
    return { ok: true, sectionStartOffset: null, sectionEndOffset: null };
  }

  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    return {
      ok: false,
      error:
        "sectionStartOffset and sectionEndOffset must both describe a non-empty range or both be null",
    };
  }

  return { ok: true, sectionStartOffset: start, sectionEndOffset: end };
}

function parseNonEmptyString(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${field} must be a non-empty string` };
  }

  return { ok: true, value: value.trim() };
}

function parseNullableString(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string or null` };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function normalizeAnchorPayload(value: unknown): unknown {
  return typeof value === "string" ? value.trim().replace(/^#/, "") : value;
}

function formatFlashback(flashback: {
  id: string;
  memoryId: string;
  sectionAnchor: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionPath: string;
  sectionStartOffset: number | null;
  sectionEndOffset: number | null;
  contentHash: string | null;
  createdAt: Date;
}) {
  return {
    id: flashback.id,
    memoryId: flashback.memoryId,
    sectionAnchor: flashback.sectionAnchor,
    sectionTitle: flashback.sectionTitle,
    sectionLevel: flashback.sectionLevel,
    sectionPath: flashback.sectionPath,
    sectionStartOffset: flashback.sectionStartOffset,
    sectionEndOffset: flashback.sectionEndOffset,
    contentHash: flashback.contentHash,
    createdAt: flashback.createdAt.toISOString(),
  };
}

function formatFlashbackError(error: unknown): Response {
  if (
    error instanceof MemoryRepositoryError &&
    error.message.includes("missing memory")
  ) {
    return json({ error: "memory was not found" }, { status: 404 });
  }

  return json({ error: "failed to create flashback" }, { status: 500 });
}

function json(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
): boolean {
  return requiredKeys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
