import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

import {
  CollectionPageRetry,
  captureCollectionPageRetryFocusIntent,
  createCollectionPageRetryController,
  restoreCollectionPageRetryFocus,
} from "../../src/components/collections/CollectionPageRetry";

describe("collection page retry", () => {
  it("renders a native retry action with surface-specific context", () => {
    const html = renderToString(() =>
      createComponent(CollectionPageRetry, {
        getFocusTarget: () => undefined,
        onRetry: () => "success",
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

  it("keeps retry ownership scoped to its captured cursor and generation", async () => {
    let cursor: string | null = "cursor-a";
    let readyCursor: string | null | undefined;
    const releases = new Map<string, () => void>();
    const controller = createCollectionPageRetryController({
      getCurrentCursor: () => cursor,
      isPageReady: (requestedCursor) => readyCursor === requestedCursor,
      revalidatePage: (requestedCursor) =>
        new Promise<void>((resolve) => {
          releases.set(requestedCursor ?? "first", resolve);
        }),
    });

    const firstRetry = controller.retryCurrentPage();
    expect(controller.isRetryingCurrentPage()).toBe(true);

    cursor = "cursor-b";
    expect(controller.isRetryingCurrentPage()).toBe(false);
    const secondRetry = controller.retryCurrentPage();
    expect(controller.isRetryingCurrentPage()).toBe(true);

    releases.get("cursor-a")?.();
    await expect(firstRetry).resolves.toBe("superseded");
    expect(controller.isRetryingCurrentPage()).toBe(true);

    readyCursor = "cursor-b";
    releases.get("cursor-b")?.();
    await expect(secondRetry).resolves.toBe("success");
    expect(controller.isRetryingCurrentPage()).toBe(false);
  });

  it("returns an unsuccessful retry to its button without stealing moved focus", () => {
    const retryButton = {
      focus: vi.fn(),
      isConnected: true,
    } as unknown as HTMLButtonElement;
    const results = {
      focus: vi.fn(),
      isConnected: true,
    } as unknown as HTMLElement;

    restoreCollectionPageRetryFocus({
      focusTarget: results,
      outcome: "error",
      retryButton,
      shouldRestoreFocus: () => true,
    });
    expect(retryButton.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(results.focus).not.toHaveBeenCalled();

    vi.mocked(retryButton.focus).mockClear();
    restoreCollectionPageRetryFocus({
      focusTarget: results,
      outcome: "success",
      retryButton,
      shouldRestoreFocus: () => true,
    });
    expect(results.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(retryButton.focus).not.toHaveBeenCalled();

    vi.mocked(results.focus).mockClear();
    restoreCollectionPageRetryFocus({
      focusTarget: results,
      outcome: "error",
      retryButton,
      shouldRestoreFocus: () => false,
    });
    expect(retryButton.focus).not.toHaveBeenCalled();
    expect(results.focus).not.toHaveBeenCalled();
  });
});
