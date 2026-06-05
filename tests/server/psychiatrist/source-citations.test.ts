import { describe, expect, it } from "vitest";

import { sanitizePsychiatristSourceCitations } from "../../../src/server/psychiatrist/source-citations";

describe("sanitizePsychiatristSourceCitations", () => {
  it("projects source URLs by dropping query, userinfo, and fragments", () => {
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
        url: "https://example.com/article",
      },
    ]);

    expect(sanitizePsychiatristSourceCitations([
      {
        sourceId: "source-raw",
        title: "Signed source",
        url: "https://user:pass@example.com/a?utm_source=x#frag",
      },
    ])).toEqual([
      {
        sourceId: "source-1",
        title: "Signed source",
        url: "https://example.com/a",
      },
    ]);
  });

  it("drops signed, redirected, and AWS credential query strings entirely", () => {
    expect(sanitizePsychiatristSourceCitations([
      {
        sourceId: "source-raw",
        title: "Short signed source",
        url: "https://example.com/article?sig=abc123&view=reader",
      },
      {
        sourceId: "source-raw",
        title: "AWS signed source",
        url: "https://example.com/article?X-Amz-Signature=abc&X-Amz-Credential=def",
      },
      {
        sourceId: "source-raw",
        title: "Redirect source",
        url: "https://example.com/a?redirect=https%3A%2F%2Fsecret.example%2F",
      },
    ])).toEqual([
      {
        sourceId: "source-1",
        title: "Short signed source",
        url: "https://example.com/article",
      },
      {
        sourceId: "source-2",
        title: "AWS signed source",
        url: "https://example.com/article",
      },
      {
        sourceId: "source-3",
        title: "Redirect source",
        url: "https://example.com/a",
      },
    ]);
  });

  it("rejects unsafe schemes and local or private hosts", () => {
    expect(sanitizePsychiatristSourceCitations([
      { sourceId: "1", title: "localhost", url: "https://localhost/a" },
      { sourceId: "2", title: "loopback", url: "http://127.0.0.1/a" },
      { sourceId: "3", title: "private", url: "http://10.0.0.5/a" },
      { sourceId: "4", title: "file", url: "file:///tmp/a" },
      { sourceId: "5", title: "js", url: "javascript:alert(1)" },
      { sourceId: "6", title: "bad", url: "not a url" },
    ])).toEqual([]);
  });
});
