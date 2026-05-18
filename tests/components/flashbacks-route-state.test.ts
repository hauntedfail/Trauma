import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  classifyFlashbackRows,
  type FlashbackRowsState,
} from "../../src/components/flashbacks/route-state";
import type { FlashbackBrowseRow } from "../../src/server/db/repositories";

const flashbacksRouteSource = readFileSync("src/routes/flashbacks/index.tsx", "utf8");
const flashbackActionMenuSource = readFileSync(
  "src/components/flashbacks/FlashbackActionMenu.tsx",
  "utf8",
);

describe("flashbacks route state", () => {
  it("keeps loading separate from empty flashbacks", () => {
    expect(classifyFlashbackRows(undefined)).toEqual({
      status: "loading",
    } satisfies FlashbackRowsState);
    expect(classifyFlashbackRows([])).toEqual({
      status: "empty",
    } satisfies FlashbackRowsState);
  });

  it("classifies loaded flashback rows as ready", () => {
    const row = {
      id: "flashback-1",
      memoryId: "memory-1",
      memoryTitle: "Memory One",
      text: "selected",
      prefix: "before ",
      suffix: " after",
      startOffset: 7,
      endOffset: 15,
      createdAt: "2026-05-11T00:00:00.000Z",
    } satisfies FlashbackBrowseRow;

    expect(classifyFlashbackRows([row])).toEqual({
      status: "ready",
      rows: [row],
    } satisfies FlashbackRowsState);
  });

  it("classifies multiple flashback rows as ready", () => {
    const rows = [
      {
        id: "flashback-1",
        memoryId: "memory-1",
        memoryTitle: "Memory One",
        text: "selected",
        prefix: "before ",
        suffix: " after",
        startOffset: 7,
        endOffset: 15,
        createdAt: "2026-05-11T00:00:00.000Z",
      },
      {
        id: "flashback-2",
        memoryId: "memory-2",
        memoryTitle: "Memory Two",
        text: "another selection",
        prefix: "start ",
        suffix: " end",
        startOffset: 10,
        endOffset: 27,
        createdAt: "2026-05-11T01:00:00.000Z",
      },
    ] satisfies FlashbackBrowseRow[];

    expect(classifyFlashbackRows(rows)).toEqual({
      status: "ready",
      rows,
    } satisfies FlashbackRowsState);
  });

  it("keeps route cards on excerpt context, source title metadata, and shared delete menu", () => {
    expect(flashbacksRouteSource).toContain("FlashbackExcerpt");
    expect(flashbacksRouteSource).toContain("prefix={flashback.prefix}");
    expect(flashbacksRouteSource).toContain("suffix={flashback.suffix}");
    expect(flashbacksRouteSource).toContain("FlashbackActionMenu");
    expect(flashbackActionMenuSource).toContain("Delete flashback");
    expect(flashbacksRouteSource).toContain("flashback.memoryTitle");
    expect(flashbacksRouteSource).not.toContain("Source memory");
  });
});
