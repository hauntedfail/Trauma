import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  CollectionPageRetry,
  captureCollectionPageRetryFocusIntent,
} from "../../src/components/collections/CollectionPageRetry";

describe("collection page retry", () => {
  it("renders a native retry action with surface-specific context", () => {
    const html = renderToString(() =>
      createComponent(CollectionPageRetry, {
        getFocusTarget: () => undefined,
        onRetry: async () => undefined,
        subject: "flashbacks",
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Retry flashbacks"');
    expect(html).toContain(">Retry</button>");
  });

  it("hands focus off only while the retry action still owns it", () => {
    const retryButton = {} as HTMLButtonElement;
    const body = {} as HTMLBodyElement;
    const anotherControl = {} as HTMLButtonElement;
    let activeElement: Element | null = retryButton;
    const shouldRestoreFocus = captureCollectionPageRetryFocusIntent(
      retryButton,
      () => activeElement,
      () => body,
    );

    activeElement = anotherControl;
    expect(shouldRestoreFocus()).toBe(false);

    activeElement = retryButton;
    const retryStillOwnedFocus = captureCollectionPageRetryFocusIntent(
      retryButton,
      () => activeElement,
      () => body,
    );
    activeElement = body;
    expect(retryStillOwnedFocus()).toBe(true);
  });
});
