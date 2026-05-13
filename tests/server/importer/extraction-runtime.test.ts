import { describe, expect, it } from "vitest";

import { createExtractorWorkerSource } from "../../../src/server/importer/extraction-runtime";

describe("createExtractorWorkerSource", () => {
  it("imports the supplied runtime module instead of source-tree extractor paths", () => {
    const source = createExtractorWorkerSource(
      "file:///app/.output/server/chunks/build/importer-runtime.mjs",
    );

    expect(source).toContain(
      "file:///app/.output/server/chunks/build/importer-runtime.mjs",
    );
    expect(source).toContain("__TRAUMA_ARTICLE_EXTRACTOR_RUNTIME__");
    expect(source).not.toContain("src/server/importer/extractor.ts");
    expect(source).not.toContain("../importer/extractor.ts");
    expect(source).not.toContain("process.cwd");
  });
});
