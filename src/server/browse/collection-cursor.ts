import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const COLLECTION_CURSOR_VERSION = 1;
const MAX_COLLECTION_CURSOR_TOKEN_LENGTH = 2048;
const MAX_COLLECTION_CURSOR_ID_LENGTH = 256;

export type CollectionCursorKind = "flashbacks" | "moments";

export interface CollectionCursorValue {
  createdAt: Date;
  id: string;
}

interface CollectionCursorPayload {
  collection: CollectionCursorKind;
  createdAt: string;
  id: string;
  version: typeof COLLECTION_CURSOR_VERSION;
}

export class CollectionCursorError extends Error {
  constructor(message = "invalid cursor") {
    super(message);
    this.name = "CollectionCursorError";
  }
}

export function encodeCollectionCursor(
  collection: CollectionCursorKind,
  cursor: CollectionCursorValue,
): string {
  const payload: CollectionCursorPayload = {
    collection,
    createdAt: formatCursorDate(cursor.createdAt),
    id: validateCursorId(cursor.id),
    version: COLLECTION_CURSOR_VERSION,
  };
  const serializedPayload = serializePayload(payload);
  const envelope = {
    checksum: createCursorChecksum(serializedPayload),
    cursor: payload,
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function decodeCollectionCursor(
  collection: CollectionCursorKind,
  token: string,
): CollectionCursorValue {
  const envelope = parseCursorEnvelope(token);
  const payload = envelope.cursor;
  if (
    payload.version !== COLLECTION_CURSOR_VERSION ||
    !isCollectionCursorKind(payload.collection) ||
    typeof payload.createdAt !== "string" ||
    typeof payload.id !== "string"
  ) {
    throw new CollectionCursorError();
  }

  const canonicalPayload: CollectionCursorPayload = {
    collection: payload.collection,
    createdAt: payload.createdAt,
    id: payload.id,
    version: COLLECTION_CURSOR_VERSION,
  };
  const serializedPayload = serializePayload(canonicalPayload);
  if (envelope.checksum !== createCursorChecksum(serializedPayload)) {
    throw new CollectionCursorError();
  }
  if (payload.collection !== collection) {
    throw new CollectionCursorError("cursor belongs to another collection");
  }

  const createdAt = new Date(payload.createdAt);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== payload.createdAt
  ) {
    throw new CollectionCursorError();
  }

  return {
    createdAt,
    id: validateCursorId(payload.id),
  };
}

function parseCursorEnvelope(token: string): {
  checksum: string;
  cursor: Record<string, unknown>;
} {
  if (
    token.length === 0 ||
    token.length > MAX_COLLECTION_CURSOR_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new CollectionCursorError();
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(token, "base64url");
  } catch {
    throw new CollectionCursorError();
  }
  if (decoded.toString("base64url") !== token) {
    throw new CollectionCursorError();
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new CollectionCursorError();
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["checksum", "cursor"]) ||
    typeof value.checksum !== "string" ||
    !isRecord(value.cursor) ||
    !hasExactKeys(value.cursor, ["collection", "createdAt", "id", "version"])
  ) {
    throw new CollectionCursorError();
  }

  return { checksum: value.checksum, cursor: value.cursor };
}

function formatCursorDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new CollectionCursorError();
  }
  return value.toISOString();
}

function validateCursorId(value: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_COLLECTION_CURSOR_ID_LENGTH ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new CollectionCursorError();
  }
  return value;
}

function serializePayload(payload: CollectionCursorPayload): string {
  return JSON.stringify(payload);
}

function createCursorChecksum(serializedPayload: string): string {
  return createHash("sha256")
    .update(serializedPayload, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function isCollectionCursorKind(value: unknown): value is CollectionCursorKind {
  return value === "flashbacks" || value === "moments";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}
