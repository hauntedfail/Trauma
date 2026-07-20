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

  it("rejects single-label and reserved private-style DNS hosts", () => {
    expect(sanitizePsychiatristSourceCitations([
      { sourceId: "1", title: "single label", url: "https://intranet/release" },
      { sourceId: "2", title: "mDNS", url: "https://printer.local/status" },
      { sourceId: "3", title: "private corp", url: "https://release.intranet.corp/notes" },
      { sourceId: "4", title: "home network", url: "https://router.home.arpa/admin" },
      { sourceId: "5", title: "reserved test", url: "https://source.example.test/notes" },
    ])).toEqual([]);
  });

  it("rejects local and private IPv6 citation hosts including IPv4-mapped forms", () => {
    expect(sanitizePsychiatristSourceCitations([
      { sourceId: "1", title: "mapped loopback", url: "http://[::ffff:127.0.0.1]/a" },
      { sourceId: "2", title: "mapped private", url: "http://[::ffff:10.0.0.5]/a" },
      { sourceId: "3", title: "mapped private hex", url: "http://[::ffff:c0a8:101]/a" },
      { sourceId: "4", title: "ipv6 loopback", url: "http://[::1]/a" },
      { sourceId: "5", title: "ipv6 unique local", url: "http://[fc00::1]/a" },
      { sourceId: "6", title: "ipv6 link local", url: "http://[fe80::1]/a" },
    ])).toEqual([]);
  });

  it("keeps public IP citation hosts after URL projection", () => {
    expect(sanitizePsychiatristSourceCitations([
      { sourceId: "1", title: "public ipv4", url: "http://8.8.8.8/a?sig=secret#frag" },
      { sourceId: "2", title: "public ipv6", url: "https://[2001:4860:4860::8888]/dns?token=x" },
    ])).toEqual([
      {
        sourceId: "source-1",
        title: "public ipv4",
        url: "http://8.8.8.8/a",
      },
      {
        sourceId: "source-2",
        title: "public ipv6",
        url: "https://[2001:4860:4860::8888]/dns",
      },
    ]);
  });
});
