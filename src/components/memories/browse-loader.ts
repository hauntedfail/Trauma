import { query, revalidate } from "@solidjs/router";

import { loadBrowseMemories, loadBrowseMemoryPage } from "~/server/memories/browse";
import { loadBrowseTaxonomy } from "~/server/taxonomy/browse";
import {
  createInitialBrowseMemoryPageRequest,
  defaultBrowseQuery,
  type BrowseMemoryPageRequest,
  type BrowseQuery,
} from "./browse-data";

export const getBrowseMemories = query(async () => {
  "use server";

  return loadBrowseMemories();
}, "browse-memories");

export const getBrowseMemoryPage = query(async (request: BrowseMemoryPageRequest) => {
  "use server";

  return loadBrowseMemoryPage(request);
}, "browse-memory-page");

export function revalidateBrowseMemories() {
  return revalidate(getBrowseMemories.key);
}

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
    revalidateBrowseMemories(),
    revalidateBrowseMemoryPages(),
    revalidateBrowseTaxonomy(),
  ]);
}
