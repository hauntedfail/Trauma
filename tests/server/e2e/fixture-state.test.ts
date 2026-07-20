import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveStoredE2eContentPath } from "../../../src/server/e2e/fixture-state";

const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";
const storePath = "/tmp/trauma-e2e-store";

describe("E2E persistence inspection content path", () => {
  it("resolves the contentPath stored on the memory row within the store", () => {
    const contentPath = `memories/${memoryId}/CONTENT.md`;

    expect(resolveStoredE2eContentPath(
      { storePath },
      memoryId,
      contentPath,
    )).toEqual({
      absolutePath: resolve(storePath, contentPath),
      memoryId,
      relativePath: contentPath,
    });
  });

  it.each([
    "../outside/CONTENT.md",
    "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f102/CONTENT.md",
  ])("rejects a non-owned stored contentPath: %s", (contentPath) => {
    expect(() => resolveStoredE2eContentPath(
      { storePath },
      memoryId,
      contentPath,
    )).toThrow("stored memory content path is not owned by the requested memory");
  });
});
