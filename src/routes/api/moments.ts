import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase, MemoryRepositoryError } from "~/server/db";
import { loadMomentBrowseRows } from "~/server/moments/browse";
import { generateMomentId } from "~/server/moments/id";
import {
  renderMemoryMarkdown,
  type ReaderTocEntry,
} from "~/server/reader/markdown-renderer";
import {
  createReaderContentHash,
  MemoryContentStoreError,
  readMemoryContent,
} from "~/server/store";

export type MomentPayloadResult =
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

const MOMENT_KEYS = [
  "memoryId",
  "sectionAnchor",
  "sectionTitle",
  "sectionLevel",
  "sectionPath",
  "sectionStartOffset",
  "sectionEndOffset",
  "contentHash",
] as const;

const REQUIRED_MOMENT_KEYS = [
  "memoryId",
  "sectionAnchor",
  "sectionTitle",
  "sectionLevel",
  "sectionPath",
] as const;

export async function GET(): Promise<Response> {
  try {
    return json(
      { moments: await loadMomentBrowseRows() },
      { status: 200 },
    );
  } catch (error) {
    if (!(error instanceof TraumaConfigError)) {
      throw error;
    }
    return json({ error: formatConfigError(error) }, { status: 500 });
  }
}

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseMomentPayloadInternal(event.request);
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
    const memory = await connection.repositories.memories.findById(payload.memoryId);
    if (memory === undefined) {
      return json({ error: "memory was not found" }, { status: 404 });
    }
    const section = await resolveMomentSection({
      config,
      payload,
    });
    if (!section.ok) {
      return json({ error: section.error }, { status: 400 });
    }

    const result = await connection.repositories.moments.create({
      id: generateMomentId(),
      memoryId: payload.memoryId,
      sectionAnchor: section.section.id,
      sectionTitle: section.section.text,
      sectionLevel: section.section.level,
      sectionPath: section.section.path,
      sectionStartOffset: section.section.startOffset ?? null,
      sectionEndOffset: section.section.endOffset ?? null,
      contentHash: section.contentHash,
      createdAt: now,
      updatedAt: now,
    });

    return json(
      {
        alreadyExists: result.alreadyExists,
        moment: formatMoment(result.moment),
      },
      { status: result.alreadyExists ? 200 : 201 },
    );
  } catch (error) {
    return formatMomentError(error);
  } finally {
    connection.close();
  }
}

async function resolveMomentSection(input: {
  config: ReturnType<typeof loadRuntimeTraumaConfig>;
  payload: Extract<MomentPayloadResult, { ok: true }>;
}): Promise<
  | { ok: true; section: ReaderTocEntry; contentHash: string }
  | { ok: false; error: string }
> {
  let rendered;
  let contentHash: string;
  try {
    const content = await readMemoryContent({
      config: input.config,
      memoryId: input.payload.memoryId,
    });
    contentHash = createReaderContentHash(content.markdown);
    rendered = renderMemoryMarkdown(content.markdown);
  } catch (error) {
    if (
      error instanceof MemoryContentStoreError &&
      error.code === "missing_content"
    ) {
      return { ok: false, error: "moment section was not found" };
    }
    throw error;
  }

  const byAnchor = rendered.toc.filter(
    (section) => section.id === input.payload.sectionAnchor,
  );
  const candidates = byAnchor.length > 0
    ? byAnchor
    : rendered.toc.filter((section) => section.path === input.payload.sectionPath);
  if (candidates.length === 0) {
    return { ok: false, error: "moment section was not found" };
  }
  if (candidates.length > 1) {
    return { ok: false, error: "moment section identity is ambiguous" };
  }

  const section = candidates[0]!;
  if (
    section.text !== input.payload.sectionTitle ||
    section.level !== input.payload.sectionLevel ||
    section.path !== input.payload.sectionPath ||
    !matchesOptionalOffset(section.startOffset, input.payload.sectionStartOffset) ||
    !matchesOptionalOffset(section.endOffset, input.payload.sectionEndOffset)
  ) {
    return {
      ok: false,
      error: "moment section identity does not match reader content",
    };
  }
  if (
    input.payload.contentHash !== null &&
    input.payload.contentHash !== contentHash
  ) {
    return {
      ok: false,
      error: "moment content hash does not match reader content",
    };
  }

  return { ok: true, section, contentHash };
}

function matchesOptionalOffset(
  serverOffset: number | undefined,
  payloadOffset: number | null,
): boolean {
  return payloadOffset === null || serverOffset === payloadOffset;
}

export const parseMomentPayload = parseMomentPayloadInternal;

async function parseMomentPayloadInternal(
  request: Request,
): Promise<MomentPayloadResult> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (!hasOnlyAllowedKeys(payload, MOMENT_KEYS)) {
    return {
      ok: false,
      error:
        "request body must contain only memoryId, sectionAnchor, sectionTitle, sectionLevel, sectionPath, sectionStartOffset, sectionEndOffset, and contentHash",
    };
  }

  if (!hasRequiredKeys(payload, REQUIRED_MOMENT_KEYS)) {
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

function formatMoment(moment: {
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
    id: moment.id,
    memoryId: moment.memoryId,
    sectionAnchor: moment.sectionAnchor,
    sectionTitle: moment.sectionTitle,
    sectionLevel: moment.sectionLevel,
    sectionPath: moment.sectionPath,
    sectionStartOffset: moment.sectionStartOffset,
    sectionEndOffset: moment.sectionEndOffset,
    contentHash: moment.contentHash,
    createdAt: moment.createdAt.toISOString(),
  };
}

function formatMomentError(error: unknown): Response {
  if (
    error instanceof MemoryRepositoryError &&
    error.message.includes("missing memory")
  ) {
    return json({ error: "memory was not found" }, { status: 404 });
  }

  return json({ error: "failed to create moment" }, { status: 500 });
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
