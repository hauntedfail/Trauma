import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { positionReaderSelectionMenu } from "../../src/components/reader/MemoryReader";

const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");

describe("memory reader highlight selection menu", () => {
  it("opens a custom menu from selection and waits for explicit highlight action", () => {
    expect(readerSource).toContain("openSelectionMenu");
    expect(readerSource).toContain("commitSelectionMenu");
    expect(readerSource).toContain('aria-label="Highlight selection"');
    expect(readerSource).toContain("onMouseUp={openSelectionMenu}");
    expect(readerSource).toContain("onClick={commitSelectionMenu}");
    expect(readerSource).not.toContain("onMouseUp={handleSelectionToggle}");
  });

  it("positions the menu above the selection when there is room", () => {
    expect(
      positionReaderSelectionMenu(
        { left: 200, right: 260, top: 120, bottom: 140, width: 60 },
        { width: 500, height: 400 },
      ),
    ).toEqual({
      left: 206,
      top: 64,
      placement: "above",
    });
  });

  it("positions the menu below and clamps it inside the viewport near edges", () => {
    expect(
      positionReaderSelectionMenu(
        { left: -20, right: 20, top: 20, bottom: 36, width: 40 },
        { width: 320, height: 240 },
      ),
    ).toEqual({
      left: 8,
      top: 44,
      placement: "below",
    });
  });
});
