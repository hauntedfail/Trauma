import { MAX_BROWSE_RESULT_LIMIT } from "./limits";
import {
  CollectionCursorError,
  decodeCollectionCursor,
  type CollectionCursorKind,
  type CollectionCursorValue,
} from "./collection-cursor";

export const DEFAULT_COLLECTION_PAGE_SIZE = 30;

export class CollectionPageInputError extends Error {
  constructor(message: "invalid cursor" | "invalid limit" | "invalid page request") {
    super(message);
    this.name = "CollectionPageInputError";
  }
}

export function parseCollectionPageInput(
  collection: CollectionCursorKind,
  input: { cursor?: string | null; limit?: number },
): { cursor: CollectionCursorValue | null; limit: number } {
  return {
    cursor: parseCursor(collection, input.cursor ?? null),
    limit: validateCollectionPageLimit(input.limit),
  };
}

export function parseExplicitCollectionPageRequest(
  collection: CollectionCursorKind,
  request: Request,
): {
  cursor: CollectionCursorValue | null;
  cursorToken: string | null;
  limit: number;
} {
  const params = new URL(request.url).searchParams;
  if (
    params.get("page") !== "1" ||
    [...params.keys()].some(
      (key) => key !== "page" && key !== "cursor" && key !== "limit",
    ) ||
    ["page", "cursor", "limit"].some((key) => params.getAll(key).length > 1)
  ) {
    throw new CollectionPageInputError("invalid page request");
  }

  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit === ""
    ? DEFAULT_COLLECTION_PAGE_SIZE
    : parseCollectionPageLimit(rawLimit);
  const rawCursor = params.get("cursor");
  const cursorToken = rawCursor === null || rawCursor === "" ? null : rawCursor;
  return {
    cursor: parseCursor(collection, cursorToken),
    cursorToken,
    limit,
  };
}

export function validateCollectionPageLimit(limit?: number): number {
  const value = limit ?? DEFAULT_COLLECTION_PAGE_SIZE;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_BROWSE_RESULT_LIMIT
  ) {
    throw new CollectionPageInputError("invalid limit");
  }
  return value;
}

function parseCollectionPageLimit(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CollectionPageInputError("invalid limit");
  }
  return validateCollectionPageLimit(Number(value));
}

function parseCursor(
  collection: CollectionCursorKind,
  token: string | null,
): CollectionCursorValue | null {
  if (token === null) {
    return null;
  }
  try {
    return decodeCollectionCursor(collection, token);
  } catch (error) {
    if (error instanceof CollectionCursorError) {
      throw new CollectionPageInputError("invalid cursor");
    }
    throw error;
  }
}
