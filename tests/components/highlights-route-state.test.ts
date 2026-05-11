import { describe, expect, it } from "vitest";

import {
  classifyHighlightRows,
  type HighlightRowsState,
} from "../../src/components/highlights/route-state";
import type { HighlightBrowseRow } from "../../src/server/db/repositories";

describe("highlights route state", () => {
  it("keeps loading separate from empty highlights", () => {
    expect(classifyHighlightRows(undefined)).toEqual({
      status: "loading",
    } satisfies HighlightRowsState);
    expect(classifyHighlightRows([])).toEqual({
      status: "empty",
    } satisfies HighlightRowsState);
  });

  it("classifies loaded highlight rows as ready", () => {
    const row = {
      id: "highlight-1",
      memoryId: "memory-1",
      memoryTitle: "Memory One",
      text: "selected",
      prefix: "before ",
      suffix: " after",
      startOffset: 7,
      endOffset: 15,
      createdAt: "2026-05-11T00:00:00.000Z",
    } satisfies HighlightBrowseRow;

    expect(classifyHighlightRows([row])).toEqual({
      status: "ready",
      rows: [row],
    } satisfies HighlightRowsState);
  });
});
