import { query } from "@solidjs/router";

import { loadFlashbackBrowseRows } from "~/server/flashbacks/browse";

export const getFlashbackBrowseRows = query(async () => {
  "use server";

  return loadFlashbackBrowseRows();
}, "flashback-browse-rows");
