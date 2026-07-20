import { describe, expect, it } from "vitest";

import {
  buildCollectionPageHref,
  readCollectionPageCursor,
  settleCollectionPage,
} from "../../src/components/collections/page-state";

describe("collection page URL state", () => {
  it("reads the opaque cursor from the URL without decoding or duplicating it", () => {
    expect(readCollectionPageCursor("?cursor=opaque_A-1")).toBe("opaque_A-1");
    expect(readCollectionPageCursor("?cursor=")).toBeNull();
    expect(readCollectionPageCursor("")).toBeNull();
  });

  it("builds canonical First and Next hrefs", () => {
    expect(buildCollectionPageHref("/flashbacks", null)).toBe("/flashbacks");
    expect(buildCollectionPageHref("/moments", "opaque+/=")).toBe(
      "/moments?cursor=opaque%2B%2F%3D",
    );
  });

  it("associates ready and error outcomes with the requested cursor", async () => {
    await expect(
      settleCollectionPage("cursor-a", async () => ({ rows: [1] })),
    ).resolves.toEqual({
      cursor: "cursor-a",
      page: { rows: [1] },
      status: "ready",
    });
    await expect(
      settleCollectionPage(null, async () => {
        throw new Error("private detail");
      }),
    ).resolves.toEqual({
      cursor: null,
      status: "error",
    });
  });
});
