import { describe, expect, it } from "vitest";

import {
  canStartFlashbackToggle,
  isExplicitFlashbackKeyboardToggle,
  shouldHandleFlashbackKeyboardToggle,
  shouldPreventFlashbackSpaceDefault,
} from "../../src/components/reader/flashback-events";

describe("reader flashback keyboard events", () => {
  it("ignores ordinary key releases over selected reader text", () => {
    expect(
      isExplicitFlashbackKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: "c",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("allows explicit keyboard flashback activation", () => {
    expect(
      isExplicitFlashbackKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("allows explicit keyboard flashback activation with Space", () => {
    expect(
      isExplicitFlashbackKeyboardToggle({
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: " ",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("prevents Space default only for a valid selection owned by the content root", () => {
    const event = {
      altKey: false,
      ctrlKey: false,
      isComposing: false,
      key: " ",
      metaKey: false,
      shiftKey: false,
    };
    const selection = {
      hasReaderSelection: true,
      targetIsReaderContent: true,
    };

    expect(shouldPreventFlashbackSpaceDefault(event, selection)).toBe(true);
    expect(shouldPreventFlashbackSpaceDefault(
      { ...event, key: "Enter" },
      selection,
    )).toBe(false);
    expect(shouldPreventFlashbackSpaceDefault(
      { ...event, ctrlKey: true },
      selection,
    )).toBe(false);
    expect(shouldPreventFlashbackSpaceDefault(
      { ...event, isComposing: true },
      selection,
    )).toBe(false);
    expect(shouldPreventFlashbackSpaceDefault(event, {
      ...selection,
      hasReaderSelection: false,
    })).toBe(false);
    expect(shouldPreventFlashbackSpaceDefault(event, {
      ...selection,
      targetIsReaderContent: false,
    })).toBe(false);
  });

  it("opens on keyup only for Enter or Space from the content root", () => {
    const event = {
      altKey: false,
      ctrlKey: false,
      isComposing: false,
      key: "Enter",
      metaKey: false,
      shiftKey: false,
    };
    const selection = {
      hasReaderSelection: true,
      targetIsReaderContent: true,
    };

    expect(shouldHandleFlashbackKeyboardToggle(event, selection)).toBe(true);
    expect(shouldHandleFlashbackKeyboardToggle(
      { ...event, key: " " },
      selection,
    )).toBe(true);
    expect(shouldHandleFlashbackKeyboardToggle(
      { ...event, altKey: true },
      selection,
    )).toBe(false);
    expect(shouldHandleFlashbackKeyboardToggle(
      { ...event, key: "a" },
      selection,
    )).toBe(false);
    expect(shouldHandleFlashbackKeyboardToggle(event, {
      ...selection,
      hasReaderSelection: false,
    })).toBe(false);
    expect(shouldHandleFlashbackKeyboardToggle(event, {
      ...selection,
      targetIsReaderContent: false,
    })).toBe(false);
  });

  it("blocks new flashback toggles while any save is pending", () => {
    expect(canStartFlashbackToggle("")).toBe(true);
    expect(canStartFlashbackToggle("1:2:first")).toBe(false);
  });
});
