import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  ScrollableUrlDisplay,
  ScrollableUrlLink,
} from "../../src/components/url/ScrollableUrlText";

const longUrl =
  "https://example.com/articles/this/is/a/very/long/source/url/that/must/not/wrap/or/consume/the/card/height";

describe("scrollable URL text", () => {
  it("renders links as one-line constrained scroll surfaces", () => {
    const html = renderToString(() =>
      createComponent(ScrollableUrlLink, {
        href: longUrl,
        url: longUrl,
      }),
    );

    expect(html).toContain("trauma-scroll-url-link");
    expect(html).toContain("trauma-scroll-url-shell");
    expect(html).toContain("trauma-scroll-url-body");
    expect(html).toContain("trauma-scroll-url-text");
    expect(html).not.toContain("wrap-anywhere");
  });

  it("supports non-clickable source URL displays with the same text surface", () => {
    const html = renderToString(() =>
      createComponent(ScrollableUrlDisplay, {
        url: "chrome://extensions",
      }),
    );

    expect(html).toContain("trauma-scroll-url-link");
    expect(html).toContain("trauma-scroll-url-shell");
    expect(html).toContain("chrome://extensions");
    expect(html).not.toContain("<a");
  });
});
