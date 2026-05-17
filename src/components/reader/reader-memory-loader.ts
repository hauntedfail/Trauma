import { query, revalidate } from "@solidjs/router";

import { loadReaderMemory } from "~/server/reader/page-data";

export const getReaderMemory = query(async (memoryId: string) => {
  "use server";

  return loadReaderMemory(memoryId);
}, "reader-memory");

export function revalidateReaderMemory(memoryId?: string) {
  return revalidate(
    memoryId === undefined
      ? getReaderMemory.key
      : getReaderMemory.keyFor(memoryId),
  );
}
