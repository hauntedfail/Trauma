import type {
  PsychiatristStreamEvent,
  PsychiatristThreadPairResponse,
} from "./psychiatrist-types";

export interface PsychiatristTranscriptPair {
  answer: string;
  citations: Array<{ source_id: string; title: string; url: string }>;
  replaceAnswerOnNextDelta?: boolean;
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
    citations: pair.assistant_response?.source_citations ?? [],
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
  if (index < 0 && event.type === "psychiatrist.turn.started" && pairId !== undefined) {
    const userPrompt = readUserPrompt(event.data);
    if (userPrompt !== undefined) {
      return [
        ...pairs,
        {
          answer: "",
          citations: [],
          pairId,
          process: [],
          status: "running",
          turnId: event.turnId,
          userPrompt,
        },
      ];
    }
  }
  if (index < 0) {
    return [...pairs];
  }
  return pairs.map((pair, pairIndex) => {
    if (pairIndex !== index) {
      return pair;
    }
    if (event.type === "psychiatrist.process.delta") {
      const text = readSafeProcessText(event.data);
      return text === undefined ? pair : { ...pair, process: [...pair.process, text] };
    }
    if (event.type === "psychiatrist.answer.delta") {
      const text = readAnswerText(event.data) ?? "";
      const nextPair = {
        ...pair,
        answer: pair.replaceAnswerOnNextDelta ? text : `${pair.answer}${text}`,
      };
      return withoutAnswerReplacementFlag(nextPair);
    }
    if (
      event.type === "psychiatrist.turn.started" ||
      event.type === "psychiatrist.regenerate.started"
    ) {
      return {
        ...pair,
        ...(event.type === "psychiatrist.regenerate.started"
          ? { replaceAnswerOnNextDelta: true }
          : {}),
        status: "running",
        turnId: event.turnId,
      };
    }
    if (
      event.type === "psychiatrist.answer.completed" ||
      event.type === "psychiatrist.regenerate.completed"
    ) {
      return withoutAnswerReplacementFlag({
        ...pair,
        citations: readSourceCitations(event.data) ?? pair.citations,
        status: "completed",
        turnId: event.turnId,
      });
    }
    if (event.type === "psychiatrist.turn.canceled") {
      return withoutAnswerReplacementFlag({
        ...pair,
        status: pair.answer === "" ? "canceled" : "completed",
        turnId: pair.answer === "" ? event.turnId : pair.turnId,
      });
    }
    if (
      event.type === "psychiatrist.answer.failed" ||
      event.type === "psychiatrist.network.permission_required"
    ) {
      const keepCompletedAnswer =
        event.type === "psychiatrist.answer.failed" ||
        readRetryAction(event.data) === "regenerate";
      return withoutAnswerReplacementFlag({
        ...pair,
        status: keepCompletedAnswer && pair.answer !== "" ? "completed" : "failed",
        turnId: keepCompletedAnswer && pair.answer !== "" ? pair.turnId : event.turnId,
      });
    }
    return pair;
  });
}

function withoutAnswerReplacementFlag(
  pair: PsychiatristTranscriptPair,
): PsychiatristTranscriptPair {
  const { replaceAnswerOnNextDelta: _replaceAnswerOnNextDelta, ...visiblePair } = pair;
  return visiblePair;
}

function readPairId(data: unknown): string | undefined {
  return isRecord(data) && typeof data.pair_id === "string"
    ? data.pair_id
    : undefined;
}

function readAnswerText(data: unknown): string | undefined {
  return isRecord(data) && typeof data.text === "string" ? data.text : undefined;
}

function readSafeProcessText(data: unknown): string | undefined {
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

function readUserPrompt(data: unknown): string | undefined {
  return isRecord(data) && typeof data.user_prompt === "string"
    ? data.user_prompt
    : undefined;
}

function readRetryAction(data: unknown): string | undefined {
  return isRecord(data) && typeof data.retry_action === "string"
    ? data.retry_action
    : undefined;
}

function readSourceCitations(
  data: unknown,
): Array<{ source_id: string; title: string; url: string }> | undefined {
  if (!isRecord(data) || !Array.isArray(data.source_citations)) {
    return undefined;
  }
  const citations = data.source_citations.filter((citation): citation is {
    source_id: string;
    title: string;
    url: string;
  } =>
    isRecord(citation) &&
    typeof citation.source_id === "string" &&
    typeof citation.title === "string" &&
    typeof citation.url === "string"
  );
  return citations.length === data.source_citations.length ? citations : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
