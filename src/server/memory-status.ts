export const EXTRACTION_STATUSES = [
  "pending",
  "success",
  "link_only",
  "failed",
] as const;

export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

const EXTRACTION_STATUS_SET: ReadonlySet<string> = new Set(EXTRACTION_STATUSES);

export function isExtractionStatus(value: string): value is ExtractionStatus {
  return EXTRACTION_STATUS_SET.has(value);
}
