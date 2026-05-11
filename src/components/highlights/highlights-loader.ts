import { query } from "@solidjs/router";

import { loadHighlightBrowseRows } from "~/server/highlights/browse";

export const getHighlightBrowseRows = query(async () => {
  "use server";

  return loadHighlightBrowseRows();
}, "highlight-browse-rows");
