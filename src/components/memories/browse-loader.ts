import { query } from "@solidjs/router";

import { loadBrowseMemories } from "~/server/memories/browse";

export const getBrowseMemories = query(async () => {
  "use server";

  return loadBrowseMemories();
}, "browse-memories");
