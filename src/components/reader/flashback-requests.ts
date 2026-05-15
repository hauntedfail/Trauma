import type { ReaderFlashbackItem } from "~/server/reader/page-data";
import type { ReaderTocEntry } from "~/server/reader/markdown-renderer";
import type { FetchFunction } from "../memories/memory-action-requests";

export type ReaderFlashbackSection = Pick<
  ReaderTocEntry,
  "id" | "level" | "path" | "startOffset" | "endOffset" | "text"
>;

export async function createFlashbackForSection(input: {
  fetch?: FetchFunction;
  memoryId: string;
  section: ReaderFlashbackSection;
}): Promise<{ alreadyExists: boolean; flashback: ReaderFlashbackItem }> {
  const fetchFunction = input.fetch ?? fetch;
  const response = await fetchFunction("/api/flashbacks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      memoryId: input.memoryId,
      sectionAnchor: input.section.id,
      sectionTitle: input.section.text,
      sectionLevel: input.section.level,
      sectionPath: input.section.path,
      sectionStartOffset: input.section.startOffset ?? null,
      sectionEndOffset: input.section.endOffset ?? null,
      contentHash: null,
    }),
  });

  if (!response.ok) {
    throw new Error("Flashback failed");
  }

  const body = await response.json();
  if (!isFlashbackResponse(body)) {
    throw new Error("Flashback response was malformed");
  }

  return body;
}

function isFlashbackResponse(value: unknown): value is {
  alreadyExists: boolean;
  flashback: ReaderFlashbackItem;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    typeof response.alreadyExists === "boolean" &&
    isReaderFlashbackItem(response.flashback)
  );
}

function isReaderFlashbackItem(value: unknown): value is ReaderFlashbackItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const flashback = value as Record<string, unknown>;
  return (
    typeof flashback.id === "string" &&
    typeof flashback.sectionAnchor === "string" &&
    typeof flashback.sectionTitle === "string" &&
    typeof flashback.sectionLevel === "number" &&
    typeof flashback.sectionPath === "string" &&
    (typeof flashback.sectionStartOffset === "number" ||
      flashback.sectionStartOffset === null) &&
    (typeof flashback.sectionEndOffset === "number" ||
      flashback.sectionEndOffset === null) &&
    (typeof flashback.contentHash === "string" || flashback.contentHash === null) &&
    typeof flashback.createdAt === "string"
  );
}
