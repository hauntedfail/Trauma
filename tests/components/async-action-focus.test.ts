import { describe, expect, it } from "vitest";

import { captureAsyncActionFocusIntent } from "../../src/components/async-action-focus";

describe("async action focus", () => {
  it("keeps body fallback only until the user moves focus elsewhere", () => {
    const actionControl = {} as HTMLElement;
    const body = {} as HTMLBodyElement;
    const outsideControl = {} as HTMLElement;
    let activeElement: Element | null = actionControl;
    const ownsCurrentFocus = captureAsyncActionFocusIntent(
      actionControl,
      () => activeElement,
      () => body,
    );

    activeElement = body;
    expect(ownsCurrentFocus()).toBe(true);

    activeElement = outsideControl;
    expect(ownsCurrentFocus()).toBe(false);

    activeElement = body;
    expect(ownsCurrentFocus()).toBe(false);
  });

  it("never claims focus when the action control was not initially focused", () => {
    const actionControl = {} as HTMLElement;
    const body = {} as HTMLBodyElement;
    let activeElement: Element | null = body;
    const ownsCurrentFocus = captureAsyncActionFocusIntent(
      actionControl,
      () => activeElement,
      () => body,
    );

    expect(ownsCurrentFocus()).toBe(false);
    activeElement = actionControl;
    expect(ownsCurrentFocus()).toBe(false);
  });
});
