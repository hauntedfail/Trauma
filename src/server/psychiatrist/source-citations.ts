import type { PsychiatristSourceCitation } from "./types";

const MAX_CITATIONS = 8;
const MAX_TITLE_CHARS = 160;
const SENSITIVE_QUERY_KEY_PATTERN =
  /(?:^|[-_])(auth|credential|key|password|secret|signature|token)(?:$|[-_])/i;

export function sanitizePsychiatristSourceCitations(
  citations: readonly PsychiatristSourceCitation[] | undefined,
): PsychiatristSourceCitation[] {
  if (citations === undefined) {
    return [];
  }
  const safe: PsychiatristSourceCitation[] = [];
  for (const citation of citations) {
    if (safe.length >= MAX_CITATIONS) {
      break;
    }
    const url = sanitizeSourceUrl(citation.url);
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

function sanitizeSourceUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

function sanitizeSourceTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  return title === "" ? "Source" : title;
}
