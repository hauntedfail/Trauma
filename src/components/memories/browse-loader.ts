import { query, revalidate } from "@solidjs/router";

import { loadBrowseMemories } from "~/server/memories/browse";
import { loadBrowseTaxonomy } from "~/server/taxonomy/browse";

export const getBrowseMemories = query(async () => {
  "use server";

  return loadBrowseMemories();
}, "browse-memories");

export function revalidateBrowseMemories() {
  return revalidate(getBrowseMemories.key);
}

export const getBrowseTaxonomy = query(async () => {
  "use server";

  return loadBrowseTaxonomy();
}, "browse-taxonomy");

export function revalidateBrowseTaxonomy() {
  return revalidate(getBrowseTaxonomy.key);
}
