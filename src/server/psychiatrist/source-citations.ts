import { projectPublicPsychiatristCitationUrl } from "../../psychiatrist/source-citation-url";
import type { PsychiatristSourceCitation } from "./types";

const MAX_CITATIONS = 8;
const MAX_TITLE_CHARS = 160;
type PsychiatristWireSourceCitation = {
  source_id: string;
  title: string;
  url: string;
};

export function sanitizePsychiatristSourceCitations(
  citations: readonly PsychiatristSourceCitation[] | undefined,
): PsychiatristSourceCitation[] {
  if (!Array.isArray(citations)) {
    return [];
  }
  const safe: PsychiatristSourceCitation[] = [];
  for (const citation of citations) {
    if (safe.length >= MAX_CITATIONS) {
      break;
    }
    if (!isSourceCitation(citation)) {
      continue;
    }
    const url = projectPublicPsychiatristCitationUrl(citation.url);
    if (url === undefined) {
      continue;
    }
    safe.push({
      sourceId: `source-${safe.length + 1}`,
      title: sanitizeSourceTitle(citation.title),
      url,
    });
  }
  return safe;
}

export function sanitizePsychiatristWireSourceCitations(
  citations: readonly PsychiatristWireSourceCitation[] | undefined,
): PsychiatristSourceCitation[] {
  if (!Array.isArray(citations)) {
    return [];
  }
  return sanitizePsychiatristSourceCitations(citations.flatMap((citation) => {
    if (
      !isRecord(citation) ||
      typeof citation.source_id !== "string" ||
      typeof citation.title !== "string" ||
      typeof citation.url !== "string"
    ) {
      return [];
    }
    return [{
      sourceId: citation.source_id,
      title: citation.title,
      url: citation.url,
    }];
  }));
}

function sanitizeSourceTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  return title === "" ? "Source" : title;
}

function isSourceCitation(value: unknown): value is PsychiatristSourceCitation {
  return isRecord(value) &&
    typeof value.sourceId === "string" &&
    typeof value.title === "string" &&
    typeof value.url === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
