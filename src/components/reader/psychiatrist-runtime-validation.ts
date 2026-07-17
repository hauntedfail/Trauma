export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function isPsychiatristSourceCitation(value: unknown): value is {
  source_id: string;
  title: string;
  url: string;
} {
  return isRecord(value) &&
    isNonEmptyString(value.source_id) &&
    typeof value.title === "string" &&
    isNonEmptyString(value.url);
}

export function isPsychiatristWarning(value: unknown): value is {
  code: string;
  message?: string;
} {
  return isRecord(value) &&
    isNonEmptyString(value.code) &&
    (value.message === undefined || typeof value.message === "string");
}
