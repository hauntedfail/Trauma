import { query, revalidate } from "@solidjs/router";

import {
  loadMomentBrowsePage,
  loadMomentBrowseRows,
} from "~/server/moments/browse";

export const getMomentBrowsePage = query(async (input: {
  cursor: string | null;
  limit?: number;
}) => {
  "use server";

  return loadMomentBrowsePage(input);
}, "moment-browse-page");

export const getMomentBrowseRows = query(async () => {
  "use server";

  return loadMomentBrowseRows();
}, "moment-browse-rows");

export function revalidateMomentBrowsePage(cursor: string | null) {
  return revalidate(getMomentBrowsePage.keyFor({ cursor }));
}

export function revalidateMomentBrowseRows() {
  return Promise.all([
    revalidate(getMomentBrowsePage.key),
    revalidate(getMomentBrowseRows.key),
  ]);
}
