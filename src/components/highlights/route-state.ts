import type { HighlightBrowseRow } from "../../server/db/repositories";

export type HighlightRowsState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; rows: HighlightBrowseRow[] };

export function classifyHighlightRows(
  rows: HighlightBrowseRow[] | undefined,
): HighlightRowsState {
  if (rows === undefined) {
    return { status: "loading" };
  }

  if (rows.length === 0) {
    return { status: "empty" };
  }

  return { status: "ready", rows };
}
