import type { FlashbackBrowseRow } from "../../server/db/repositories";

export type FlashbackRowsState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; rows: FlashbackBrowseRow[] };

export function classifyFlashbackRows(
  rows: FlashbackBrowseRow[] | undefined,
): FlashbackRowsState {
  if (rows === undefined) {
    return { status: "loading" };
  }

  if (rows.length === 0) {
    return { status: "empty" };
  }

  return { status: "ready", rows };
}
