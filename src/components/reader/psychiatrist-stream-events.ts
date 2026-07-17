import {
  PSYCHIATRIST_STREAM_EVENT_TYPES,
  type PsychiatristStreamEvent,
  type PsychiatristStreamEventType,
} from "./psychiatrist-types";
import {
  isNonEmptyString,
  isPsychiatristSourceCitation,
  isPsychiatristWarning,
  isRecord,
} from "./psychiatrist-runtime-validation";

export interface PsychiatristStreamEventScope {
  eventType: PsychiatristStreamEventType;
  memoryId: string;
  threadId: string;
  turnId: string;
}

export function parsePsychiatristStreamEvent(
  raw: unknown,
  expected: PsychiatristStreamEventScope,
): PsychiatristStreamEvent | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  try {
    const value = JSON.parse(raw) as unknown;
    return isPsychiatristStreamEvent(value, expected) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isPsychiatristStreamEvent(
  value: unknown,
  expected: PsychiatristStreamEventScope,
): value is PsychiatristStreamEvent {
  return isRecord(value) &&
    isKnownPsychiatristStreamEventType(value.type) &&
    value.type === expected.eventType &&
    isNonEmptyString(value.eventId) &&
    value.memoryId === expected.memoryId &&
    value.threadId === expected.threadId &&
    value.turnId === expected.turnId &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    value.timestamp >= 0 &&
    isPsychiatristStreamEventData(value.type, value.data);
}

function isKnownPsychiatristStreamEventType(
  value: unknown,
): value is PsychiatristStreamEventType {
  return typeof value === "string" &&
    (PSYCHIATRIST_STREAM_EVENT_TYPES as readonly string[]).includes(value);
}

function isPsychiatristStreamEventData(
  type: PsychiatristStreamEventType,
  data: unknown,
): boolean {
  if (!isRecord(data)) {
    return false;
  }
  switch (type) {
    case "psychiatrist.turn.started":
      return isStartedData(data, true);
    case "psychiatrist.regenerate.started":
      return isStartedData(data, false);
    case "psychiatrist.process.delta":
    case "psychiatrist.answer.delta":
      return typeof data.text === "string";
    case "psychiatrist.answer.completed":
    case "psychiatrist.regenerate.completed":
      return isCompletionData(data);
    case "psychiatrist.answer.failed":
      return isFailureData(data);
    case "psychiatrist.turn.canceled":
      return isCanceledData(data);
    case "psychiatrist.network.permission_required":
      return isNetworkPermissionData(data);
  }
}

function isStartedData(
  data: Record<string, unknown>,
  permitsUserPrompt: boolean,
): boolean {
  return isNonEmptyString(data.pair_id) &&
    data.status === "running" &&
    (!permitsUserPrompt || data.user_prompt === undefined ||
      typeof data.user_prompt === "string");
}

function isCompletionData(data: Record<string, unknown>): boolean {
  return isNonEmptyString(data.pair_id) &&
    isOptionalString(data.text) &&
    (data.source_citations === undefined ||
      Array.isArray(data.source_citations) &&
      data.source_citations.every(isPsychiatristSourceCitation)) &&
    (data.warning === undefined || isPsychiatristWarning(data.warning));
}

function isFailureData(data: Record<string, unknown>): boolean {
  return isNonEmptyString(data.code) &&
    isOptionalNonEmptyString(data.pair_id) &&
    isOptionalString(data.message) &&
    isOptionalString(data.action) &&
    (data.retry_mode === undefined ||
      data.retry_mode === "first_answer" ||
      data.retry_mode === "regenerate");
}

function isCanceledData(data: Record<string, unknown>): boolean {
  return isNonEmptyString(data.code) &&
    (data.status === undefined || data.status === "canceled") &&
    (data.warning === undefined || isPsychiatristWarning(data.warning));
}

function isNetworkPermissionData(data: Record<string, unknown>): boolean {
  return data.code === "network_permission_required" &&
    isNonEmptyString(data.pair_id) &&
    data.retry_action === "allow_web_sources" &&
    (data.retry_mode === "first_answer" || data.retry_mode === "regenerate") &&
    isNonEmptyString(data.retry_turn_id) &&
    typeof data.user_prompt === "string" &&
    isOptionalString(data.message);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}
