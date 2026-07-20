import { describe, expect, it, vi } from "vitest";

import {
  captureAsyncActionFocusIntent,
  type AsyncActionFocusOwnership,
} from "../../src/components/async-action-focus";
import {
  captureCollectionRowRemovalFocus,
} from "../../src/components/collections/collection-row-removal-focus";

describe("collection row removal focus", () => {
  it("prefers the next row primary link, then the previous row", async () => {
    const body = {} as HTMLBodyElement;
    const activeControl = {} as HTMLButtonElement;
    let activeElement: Element | null = activeControl;
    const nextLink = focusableElement();
    const previousLink = focusableElement();
    const removedRow = collectionRow({
      contains: activeElement,
      link: undefined,
    });
    const nextRow = collectionRow({ link: nextLink });
    const previousRow = collectionRow({ link: previousLink });
    const pageRegion = collectionRegion([previousRow, removedRow, nextRow]);

    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });

    activeElement = body;
    restore();
    await Promise.resolve();

    expect(nextLink.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(previousLink.focus).not.toHaveBeenCalled();

    vi.mocked(nextLink.focus).mockClear();
    (nextLink as unknown as { isConnected: boolean }).isConnected = false;
    activeElement = activeControl;
    const restoreToPrevious = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });
    activeElement = body;
    restoreToPrevious();
    await Promise.resolve();

    expect(previousLink.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("falls back to the focusable results region when no row survives", async () => {
    const body = {} as HTMLBodyElement;
    const activeControl = {} as HTMLButtonElement;
    let activeElement: Element | null = activeControl;
    const removedRow = collectionRow({
      contains: activeElement,
      link: undefined,
    });
    const pageRegion = collectionRegion([removedRow]);

    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });

    activeElement = body;
    restore();
    await Promise.resolve();

    expect(pageRegion.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("retains explicit ownership after a focused confirmation becomes disabled", async () => {
    const body = {} as HTMLBodyElement;
    const activeElement: Element | null = body;
    const nextLink = focusableElement();
    const removedRow = collectionRow({ link: undefined });
    const pageRegion = collectionRegion([
      removedRow,
      collectionRow({ link: nextLink }),
    ]);

    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });

    restore();
    await Promise.resolve();

    expect(nextLink.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not infer body focus ownership from the removed row", async () => {
    const body = {} as HTMLBodyElement;
    const activeElement: Element | null = body;
    const nextLink = focusableElement();
    const removedRow = collectionRow({ link: undefined });
    const pageRegion = collectionRegion([
      removedRow,
      collectionRow({ link: nextLink }),
    ]);

    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body, false),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });

    restore();
    await Promise.resolve();

    expect(nextLink.focus).not.toHaveBeenCalled();
    expect(pageRegion.focus).not.toHaveBeenCalled();
  });

  it("resolves the captured row identity again after revalidation", async () => {
    const body = {} as HTMLBodyElement;
    const activeControl = {} as HTMLButtonElement;
    let activeElement: Element | null = activeControl;
    const removedRow = collectionRow({ contains: activeControl });
    const capturedNextRow = collectionRow({ link: focusableElement() });
    const rows = [removedRow, capturedNextRow];
    const pageRegion = collectionRegion(rows);
    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });
    const replacementLink = focusableElement();
    const replacementRow = collectionRow({ link: replacementLink });
    replacementRow.dataset.collectionRow = capturedNextRow.dataset.collectionRow;
    (capturedNextRow as unknown as { isConnected: boolean }).isConnected = false;
    rows.splice(1, 1, replacementRow);

    activeElement = body;
    restore();
    await Promise.resolve();

    expect(replacementLink.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("restores a replacement after its first managed target disconnects", async () => {
    const body = {} as HTMLBodyElement;
    const activeControl = {} as HTMLButtonElement;
    let activeElement: Element | null = activeControl;
    const removedRow = collectionRow({ contains: activeControl });
    const firstLink = focusableElement();
    const capturedNextRow = collectionRow({ link: firstLink });
    const rows = [removedRow, capturedNextRow];
    const pageRegion = collectionRegion(rows);
    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });

    activeElement = body;
    restore();
    await Promise.resolve();
    expect(firstLink.focus).toHaveBeenCalledWith({ preventScroll: true });

    activeElement = firstLink;
    const replacementLink = focusableElement();
    const replacementRow = collectionRow({ link: replacementLink });
    replacementRow.dataset.collectionRow = capturedNextRow.dataset.collectionRow;
    (firstLink as unknown as { isConnected: boolean }).isConnected = false;
    rows.splice(1, 1, replacementRow);
    activeElement = body;
    restore();
    await Promise.resolve();

    expect(replacementLink.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("uses a newly rendered surviving row when revalidation refills the page", async () => {
    const body = {} as HTMLBodyElement;
    const activeControl = {} as HTMLButtonElement;
    let activeElement: Element | null = activeControl;
    const removedRow = collectionRow({ contains: activeControl });
    const rows = [removedRow];
    const pageRegion = collectionRegion(rows);
    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });
    (removedRow as unknown as { isConnected: boolean }).isConnected = false;
    rows.splice(0, 1);

    activeElement = body;
    restore();
    await Promise.resolve();

    expect(pageRegion.focus).toHaveBeenCalledWith({ preventScroll: true });

    const refillLink = focusableElement();
    rows.push(collectionRow({ link: refillLink }));
    activeElement = pageRegion;
    restore();
    await Promise.resolve();

    expect(refillLink.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not let an older removal reclaim focus during a newer action", async () => {
    const body = {} as HTMLBodyElement;
    const firstControl = {} as HTMLButtonElement;
    const secondControl = {} as HTMLButtonElement;
    let activeElement: Element | null = firstControl;
    const firstFallbackLink = focusableElement();
    const firstRow = collectionRow({ contains: firstControl });
    const secondRow = collectionRow({
      contains: secondControl,
      link: firstFallbackLink,
    });
    const finalRow = collectionRow({ link: focusableElement() });
    const pageRegion = collectionRegion([firstRow, secondRow, finalRow]);
    const restoreOlderRemoval = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: firstRow,
    });

    activeElement = secondControl;
    captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: secondRow,
    });
    activeElement = body;
    restoreOlderRemoval();
    await Promise.resolve();

    expect(firstFallbackLink.focus).not.toHaveBeenCalled();
    expect(pageRegion.focus).not.toHaveBeenCalled();
  });

  it.each([
    ["aria-disabled", { ariaDisabled: true }],
    ["missing href", { hasHref: false }],
    ["negative tab index", { tabIndex: -1 }],
    ["inert subtree", { inert: true }],
    ["native disabled state", { disabled: true, tagName: "BUTTON" }],
  ] as const)(
    "skips a connected next primary link with %s",
    async (_label, nextLinkState) => {
      const body = {} as HTMLBodyElement;
      const activeControl = {} as HTMLButtonElement;
      let activeElement: Element | null = activeControl;
      const previousLink = focusableElement();
      const nextLink = focusableElement(nextLinkState);
      const removedRow = collectionRow({ contains: activeControl });
      const pageRegion = collectionRegion([
        collectionRow({ link: previousLink }),
        removedRow,
        collectionRow({ link: nextLink }),
      ]);
      const restore = captureCollectionRowRemovalFocus({
        focusOwnership: testFocusOwnership(() => activeElement, body),
        pageRegion,
        readActiveElement: () => activeElement,
        row: removedRow,
      });

      activeElement = body;
      restore();
      await Promise.resolve();

      expect(nextLink.focus).not.toHaveBeenCalled();
      expect(previousLink.focus).toHaveBeenCalledWith({ preventScroll: true });
    },
  );

  it("does not steal focus moved outside the removed row during deletion", async () => {
    const body = {} as HTMLBodyElement;
    const activeControl = {} as HTMLButtonElement;
    const outsideControl = focusableElement();
    let activeElement: Element | null = activeControl;
    const nextLink = focusableElement();
    const removedRow = collectionRow({
      contains: activeElement,
      link: undefined,
    });
    const pageRegion = collectionRegion([
      removedRow,
      collectionRow({ link: nextLink }),
    ]);

    const restore = captureCollectionRowRemovalFocus({
      focusOwnership: testFocusOwnership(() => activeElement, body),
      pageRegion,
      readActiveElement: () => activeElement,
      row: removedRow,
    });

    activeElement = outsideControl;
    restore();
    await Promise.resolve();

    expect(nextLink.focus).not.toHaveBeenCalled();
    expect(pageRegion.focus).not.toHaveBeenCalled();
  });
});

function focusableElement(input: {
  ariaDisabled?: boolean;
  disabled?: boolean;
  hasHref?: boolean;
  inert?: boolean;
  tabIndex?: number;
  tagName?: string;
} = {}): HTMLElement {
  const tagName = input.tagName ?? "A";
  const hasHref = input.hasHref ?? tagName === "A";
  return {
    closest: (selector: string) =>
      selector === "[inert]" && input.inert === true ? {} : null,
    disabled: input.disabled ?? false,
    focus: vi.fn(),
    getAttribute: (name: string) =>
      name === "aria-disabled" && input.ariaDisabled === true ? "true" : null,
    hasAttribute: (name: string) => name === "href" && hasHref,
    inert: input.inert ?? false,
    isConnected: true,
    tabIndex: input.tabIndex ?? 0,
    tagName,
  } as unknown as HTMLElement;
}

function testFocusOwnership(
  readActiveElement: () => Element | null,
  body: HTMLElement,
  actionOwnsFocus = true,
): AsyncActionFocusOwnership {
  const actionControl = readActiveElement();
  const ownsCurrentFocus = actionControl === null
    ? () => false
    : captureAsyncActionFocusIntent(
        actionControl as HTMLElement,
        readActiveElement,
        () => body,
      );
  return {
    actionOwnsFocus,
    ownsCurrentFocus: () => actionOwnsFocus && ownsCurrentFocus(),
  };
}

let collectionRowId = 0;

function collectionRow(input: {
  contains?: Element | null;
  link?: HTMLElement;
}): HTMLElement {
  return {
    contains: (candidate: Element | null) => candidate === input.contains,
    dataset: { collectionRow: `row-${collectionRowId += 1}` },
    isConnected: true,
    querySelector: () => input.link,
  } as unknown as HTMLElement;
}

function collectionRegion(rows: HTMLElement[]): HTMLElement {
  return {
    focus: vi.fn(),
    isConnected: true,
    querySelectorAll: () => rows,
  } as unknown as HTMLElement;
}
