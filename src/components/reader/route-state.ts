import type { ReaderMemoryResult } from "../../server/reader/page-data";

export function titleForReaderResult(result: ReaderMemoryResult | undefined) {
  if (result?.status === "ready") {
    return `${result.memory.title} | TRAUMA`;
  }

  return "Memory | TRAUMA";
}
export function readerHttpStatusCode(result: ReaderMemoryResult | undefined) {
  if (result?.status === "not_found" || result?.status === "content_missing") {
    return 404;
  }

  if (result?.status === "unavailable") {
    return 503;
  }

  return undefined;
}
