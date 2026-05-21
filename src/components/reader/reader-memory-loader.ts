import { query, revalidate } from "@solidjs/router";

import { loadReaderMemory } from "~/server/reader/page-data";
import type { SupportedLanguageCode } from "~/server/translation/languages";

export const getReaderMemory = query(async (
  memoryId: string,
  langCode?: SupportedLanguageCode,
) => {
  "use server";

  return loadReaderMemory(memoryId, { langCode });
}, "reader-memory");

export function revalidateReaderMemory(
  memoryId?: string,
  langCode?: SupportedLanguageCode,
) {
  return revalidate(
    memoryId === undefined
      ? getReaderMemory.key
      : getReaderMemory.keyFor(memoryId, langCode),
  );
}
