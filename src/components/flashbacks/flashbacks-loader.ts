import { query, revalidate } from "@solidjs/router";

import {
  loadBrowseFlashbacksForMemories,
  loadFlashbackBrowsePage,
  loadFlashbackBrowseRows,
  loadRecentFlashbackBrowseRows,
} from "~/server/flashbacks/browse";

export const getFlashbackBrowsePage = query(async (input: {
  cursor: string | null;
  limit?: number;
}) => {
  "use server";

  return loadFlashbackBrowsePage(input);
}, "flashback-browse-page");

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
    revalidate(getFlashbackBrowsePage.key),
    revalidate(getFlashbackBrowseRows.key),
    revalidate(getRecentFlashbackBrowseRows.key),
    revalidate(getBrowseFlashbacksForMemories.key),
  ]);
}
