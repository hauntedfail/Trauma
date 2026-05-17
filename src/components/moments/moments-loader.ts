import { query, revalidate } from "@solidjs/router";

import { loadMomentBrowseRows } from "~/server/moments/browse";

export const getMomentBrowseRows = query(async () => {
  "use server";

  return loadMomentBrowseRows();
}, "moment-browse-rows");

export function revalidateMomentBrowseRows() {
  return revalidate(getMomentBrowseRows.key);
}
