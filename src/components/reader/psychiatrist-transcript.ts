import type {
  PsychiatristStreamEvent,
  PsychiatristThreadPairResponse,
} from "./psychiatrist-types";

export interface PsychiatristTranscriptPair {
  answer: string;
  pairId: string;
  process: string[];
  status: PsychiatristThreadPairResponse["status"] | "running";
  turnId: string;
  userPrompt: string;
}

export function toPsychiatristTranscriptPairs(
  pairs: readonly PsychiatristThreadPairResponse[],
): PsychiatristTranscriptPair[] {
  return pairs.map((pair) => ({
    answer: pair.assistant_response?.content ?? "",
    pairId: pair.pair_id,
    process: [],
    status: pair.status,
    turnId: pair.turn_id,
    userPrompt: pair.user_prompt.content,
  }));
}

export function applyPsychiatristStreamEvent(
  pairs: readonly PsychiatristTranscriptPair[],
  event: PsychiatristStreamEvent,
): PsychiatristTranscriptPair[] {
  const pairId = readPairId(event.data);
  const index = pairId === undefined
    ? pairs.findIndex((pair) => pair.turnId === event.turnId)
    : pairs.findIndex((pair) => pair.pairId === pairId);
  if (index < 0) {
    return [...pairs];
  }
  return pairs.map((pair, pairIndex) => {
    if (pairIndex !== index) {
      return pair;
    }
    if (event.type === "psychiatrist.process.delta") {
      const text = readSafeText(event.data);
      return text === undefined ? pair : { ...pair, process: [...pair.process, text] };
    }
    if (event.type === "psychiatrist.answer.delta") {
      return { ...pair, answer: `${pair.answer}${readSafeText(event.data) ?? ""}` };
    }
    if (
      event.type === "psychiatrist.turn.started" ||
      event.type === "psychiatrist.regenerate.started"
    ) {
      return {
        ...pair,
        ...(event.type === "psychiatrist.regenerate.started" ? { answer: "" } : {}),
        status: "running",
        turnId: event.turnId,
      };
    }
    if (
      event.type === "psychiatrist.answer.completed" ||
      event.type === "psychiatrist.regenerate.completed"
    ) {
      return { ...pair, status: "completed", turnId: event.turnId };
    }
    if (event.type === "psychiatrist.turn.canceled") {
      return { ...pair, status: "canceled", turnId: event.turnId };
    }
    if (
      event.type === "psychiatrist.answer.failed" ||
      event.type === "psychiatrist.network.permission_required"
    ) {
      return { ...pair, status: "failed", turnId: event.turnId };
    }
    return pair;
  });
}

function readPairId(data: unknown): string | undefined {
  return isRecord(data) && typeof data.pair_id === "string"
    ? data.pair_id
    : undefined;
}

function readSafeText(data: unknown): string | undefined {
  if (!isRecord(data) || typeof data.text !== "string") {
    return undefined;
  }
  const normalized = data.text.toLowerCase();
  if (
    normalized.includes("chain-of-thought") ||
    normalized.includes("chain of thought") ||
    normalized.includes("hidden reasoning") ||
    normalized.includes("/private/") ||
    normalized.includes("credential") ||
    normalized.includes("token")
  ) {
    return undefined;
  }
  return data.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
