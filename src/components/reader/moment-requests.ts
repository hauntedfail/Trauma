import type { ReaderMomentItem } from "~/server/reader/page-data";
import type { ReaderTocEntry } from "~/server/reader/markdown-renderer";
import type { SupportedLanguageCode } from "~/settings/languages";
import type { FetchFunction } from "../memories/memory-action-requests";

export type ReaderMomentSection = Pick<
  ReaderTocEntry,
  "id" | "level" | "path" | "startOffset" | "endOffset" | "text"
>;

export async function createMomentForSection(input: {
  fetch?: FetchFunction;
  langCode?: SupportedLanguageCode;
  memoryId: string;
  section: ReaderMomentSection;
}): Promise<{ alreadyExists: boolean; moment: ReaderMomentItem }> {
  const fetchFunction = input.fetch ?? fetch;
  const response = await fetchFunction("/api/moments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      memoryId: input.memoryId,
      ...(input.langCode === undefined ? {} : { langCode: input.langCode }),
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
    throw new Error(await readMomentFailureMessage(response));
  }

  const body = await response.json();
  if (!isMomentResponse(body)) {
    throw new Error("Moment response was malformed");
  }

  return body;
}

async function readMomentFailureMessage(response: Response): Promise<string> {
  const fallback = "Moment failed";
  const body = await response.text();
  if (body.trim() === "") {
    return fallback;
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error === "string"
    ) {
      const errorMessage = (payload as { error: string }).error;
      return errorMessage;
    }
  } catch {
    return body;
  }

  return body;
}

function isMomentResponse(value: unknown): value is {
  alreadyExists: boolean;
  moment: ReaderMomentItem;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    typeof response.alreadyExists === "boolean" &&
    isReaderMomentItem(response.moment)
  );
}

function isReaderMomentItem(value: unknown): value is ReaderMomentItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const moment = value as Record<string, unknown>;
  return (
    typeof moment.id === "string" &&
    typeof moment.sectionAnchor === "string" &&
    typeof moment.sectionTitle === "string" &&
    typeof moment.sectionLevel === "number" &&
    typeof moment.sectionPath === "string" &&
    (typeof moment.sectionStartOffset === "number" ||
      moment.sectionStartOffset === null) &&
    (typeof moment.sectionEndOffset === "number" ||
      moment.sectionEndOffset === null) &&
    (typeof moment.contentHash === "string" || moment.contentHash === null) &&
    typeof moment.createdAt === "string"
  );
}
