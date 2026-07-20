import { query, revalidate } from "@solidjs/router";

import { loadBrowseMemoryPage } from "~/server/memories/browse";
import { loadBrowseTaxonomy } from "~/server/taxonomy/browse";
import {
  createInitialBrowseMemoryPageRequest,
  defaultBrowseQuery,
  type BrowseMemoryPageRequest,
  type BrowseQuery,
} from "./browse-data";

export const getBrowseMemoryPage = query(async (request: BrowseMemoryPageRequest) => {
  "use server";

  return loadBrowseMemoryPage(request);
}, "browse-memory-page");

export function revalidateBrowseMemoryPages() {
  return revalidate(getBrowseMemoryPage.key);
}

export function revalidateBrowseMemoryFirstPage(query: BrowseQuery = defaultBrowseQuery) {
  return revalidate(
    getBrowseMemoryPage.keyFor(createInitialBrowseMemoryPageRequest(query)),
  );
}

export const getBrowseTaxonomy = query(async () => {
  "use server";

  return loadBrowseTaxonomy();
}, "browse-taxonomy");

export function revalidateBrowseTaxonomy() {
  return revalidate(getBrowseTaxonomy.key);
}

export async function revalidateBrowseMemoryWorkspace() {
  await Promise.all([
    revalidateBrowseMemoryPages(),
    revalidateBrowseTaxonomy(),
  ]);
}
