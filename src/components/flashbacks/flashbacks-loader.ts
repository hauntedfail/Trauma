import { query, revalidate } from "@solidjs/router";

import {
  loadBrowseFlashbacksForMemories,
  loadFlashbackBrowseRows,
  loadRecentFlashbackBrowseRows,
} from "~/server/flashbacks/browse";

export const getFlashbackBrowseRows = query(async () => {
  "use server";

  return loadFlashbackBrowseRows();
}, "flashback-browse-rows");

export const getRecentFlashbackBrowseRows = query(async (limit: number) => {
  "use server";

  return loadRecentFlashbackBrowseRows({ limit });
}, "recent-flashback-browse-rows");

export const getBrowseFlashbacksForMemories = query(async (input: {
  memoryIds: string[];
  selectedFlashbackId: string;
}) => {
  "use server";

  return loadBrowseFlashbacksForMemories(input);
}, "browse-flashbacks-for-memories");

export async function revalidateFlashbackBrowseRows() {
  await Promise.all([
    revalidate(getFlashbackBrowseRows.key),
    revalidate(getRecentFlashbackBrowseRows.key),
    revalidate(getBrowseFlashbacksForMemories.key),
  ]);
}
