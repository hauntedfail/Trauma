import { describe, expect, it } from "vitest";

import { sanitizePsychiatristSourceCitations } from "../../../src/server/psychiatrist/source-citations";

describe("sanitizePsychiatristSourceCitations", () => {
  it("strips camelCase credential query keys from source URLs", () => {
    expect(sanitizePsychiatristSourceCitations([
      {
        sourceId: "source-raw",
        title: "Signed source",
        url: "https://example.com/article?apiKey=secret&accessToken=hidden&view=reader",
      },
    ])).toEqual([
      {
        sourceId: "source-1",
        title: "Signed source",
        url: "https://example.com/article?view=reader",
      },
    ]);
  });

  it("strips short signed URL query keys from source URLs", () => {
    expect(sanitizePsychiatristSourceCitations([
      {
        sourceId: "source-raw",
        title: "Signed source",
        url: "https://example.com/article?sig=abc123&view=reader",
      },
    ])).toEqual([
      {
        sourceId: "source-1",
        title: "Signed source",
        url: "https://example.com/article?view=reader",
      },
    ]);
  });
});
