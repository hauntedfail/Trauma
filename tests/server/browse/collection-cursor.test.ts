import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  CollectionCursorError,
  decodeCollectionCursor,
  encodeCollectionCursor,
} from "../../../src/server/browse/collection-cursor";

describe("collection browse cursor", () => {
  const cursor = {
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    id: "flashback-019f",
  };

  it("round-trips an opaque base64url v1 cursor for its collection", () => {
    const token = encodeCollectionCursor("flashbacks", cursor);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url").toString("utf8")).toContain(
      '"version":1',
    );
    expect(decodeCollectionCursor("flashbacks", token)).toEqual(cursor);
  });

  it("rejects a cursor issued for another collection", () => {
    const token = encodeCollectionCursor("flashbacks", cursor);

    expect(() => decodeCollectionCursor("moments", token)).toThrowError(
      new CollectionCursorError("cursor belongs to another collection"),
    );
  });

  it("rejects a cursor whose encoded envelope was tampered with", () => {
    const token = encodeCollectionCursor("flashbacks", cursor);
    const pivot = Math.floor(token.length / 2);
    const replacement = token[pivot] === "A" ? "B" : "A";
    const tampered = `${token.slice(0, pivot)}${replacement}${token.slice(pivot + 1)}`;

    expect(() => decodeCollectionCursor("flashbacks", tampered)).toThrowError(
      CollectionCursorError,
    );
  });

  it.each([
    "",
    "not+base64url",
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from(
      JSON.stringify({
        checksum: "invalid",
        cursor: {
          collection: "flashbacks",
          createdAt: "not-a-date",
          id: "flashback-019f",
          version: 2,
        },
      }),
      "utf8",
    ).toString("base64url"),
  ])("rejects invalid token %j", (token) => {
    expect(() => decodeCollectionCursor("flashbacks", token)).toThrowError(
      CollectionCursorError,
    );
  });
});
