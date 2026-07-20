import type {
  PsychiatristStreamEvent,
  PsychiatristThreadPairResponse,
} from "./psychiatrist-types";

export interface PsychiatristTranscriptPair {
  answer: string;
  citations: Array<{ source_id: string; title: string; url: string }>;
  draftAnswer?: string;
  draftOriginalTurnId?: string;
  draftTurnId?: string;
  pairId: string;
  process: string[];
  retryAction?: "allow_web_sources";
  retryMode?: "first_answer" | "regenerate";
  retryTurnId?: string;
  status: PsychiatristThreadPairResponse["status"] | "running";
  turnId: string;
  userPrompt: string;
}

export const PSYCHIATRIST_MAX_PROCESS_ROWS_PER_PAIR = 8;

export function toPsychiatristTranscriptPairs(
  pairs: readonly PsychiatristThreadPairResponse[],
): PsychiatristTranscriptPair[] {
  return pairs.map((pair) => ({
    answer: pair.assistant_response?.content ?? "",
    citations: pair.assistant_response?.source_citations ?? [],
    pairId: pair.pair_id,
    process: [],
    ...(pair.retry_action === undefined ? {} : { retryAction: pair.retry_action }),
    ...(pair.retry_mode === undefined ? {} : { retryMode: pair.retry_mode }),
    ...(pair.retry_turn_id === undefined ? {} : { retryTurnId: pair.retry_turn_id }),
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
      return text === undefined ? pair : appendProcessText(pair, text);
    }
    if (event.type === "psychiatrist.answer.delta") {
      const text = readAnswerText(event.data) ?? "";
      if (pair.draftTurnId !== undefined) {
        if (pair.draftTurnId !== event.turnId) {
          return pair;
        }
        return {
          ...pair,
          draftAnswer: `${pair.draftAnswer ?? ""}${text}`,
        };
      }
      if (pair.turnId !== event.turnId) {
        return pair;
      }
      return {
        ...pair,
        answer: `${pair.answer}${text}`,
      };
    }
    if (
      event.type === "psychiatrist.turn.started" ||
      event.type === "psychiatrist.regenerate.started"
    ) {
      return {
        ...pair,
        process: [],
        ...(event.type === "psychiatrist.regenerate.started"
          ? { draftAnswer: "", draftOriginalTurnId: pair.turnId, draftTurnId: event.turnId }
          : {}),
        status: "running",
        turnId: event.turnId,
      };
    }
    if (
      event.type === "psychiatrist.answer.completed" ||
      event.type === "psychiatrist.regenerate.completed"
    ) {
      const answer = readAnswerText(event.data);
      const completedRegenerateAnswer = event.type === "psychiatrist.regenerate.completed" &&
          pair.draftTurnId === event.turnId
        ? pair.draftAnswer
        : undefined;
      return withoutRegenerateDraft(withoutRetryState({
        ...pair,
        ...(answer === undefined && completedRegenerateAnswer === undefined
          ? {}
          : { answer: answer ?? completedRegenerateAnswer ?? "" }),
        citations: readSourceCitations(event.data) ?? pair.citations,
        status: "completed",
        turnId: event.turnId,
      }));
    }
    if (event.type === "psychiatrist.turn.canceled") {
      const keepsCompletedAnswer = pair.status === "completed" ||
        pair.draftTurnId === event.turnId;
      return withoutRegenerateDraft(withoutRetryState({
        ...pair,
        ...(keepsCompletedAnswer ? {} : { answer: "" }),
        status: keepsCompletedAnswer ? "completed" : "canceled",
        turnId: keepsCompletedAnswer ? pair.draftOriginalTurnId ?? pair.turnId : event.turnId,
      }));
    }
    if (
      event.type === "psychiatrist.answer.failed" ||
      event.type === "psychiatrist.network.permission_required"
    ) {
      const retryAction = readRetryAction(event.data);
      const retryMode = readRetryMode(event.data);
      const retryTurnId = readRetryTurnId(event.data);
      const keepCompletedAnswer = pair.answer !== "" && (
        pair.draftTurnId === event.turnId ||
        retryMode === "regenerate"
      );
      const nextPair = withoutRetryState(pair);
      return withoutRegenerateDraft({
        ...nextPair,
        ...(retryAction === "allow_web_sources" ? { retryAction } : {}),
        ...(retryMode === undefined ? {} : { retryMode }),
        ...(retryTurnId === undefined ? {} : { retryTurnId }),
        ...(keepCompletedAnswer ? {} : { answer: "" }),
        status: keepCompletedAnswer ? "completed" : "failed",
        turnId: keepCompletedAnswer
          ? pair.draftOriginalTurnId ?? pair.turnId
          : event.turnId,
      });
    }
    return pair;
  });
}

function withoutRegenerateDraft(
  pair: PsychiatristTranscriptPair,
): PsychiatristTranscriptPair {
  const {
    draftAnswer: _draftAnswer,
    draftOriginalTurnId: _draftOriginalTurnId,
    draftTurnId: _draftTurnId,
    ...visiblePair
  } = pair;
  return visiblePair;
}

function withoutRetryState(
  pair: PsychiatristTranscriptPair,
): PsychiatristTranscriptPair {
  const {
    retryAction: _retryAction,
    retryMode: _retryMode,
    retryTurnId: _retryTurnId,
    ...visiblePair
  } = pair;
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
  const text = data.text.replace(/\s+/g, " ").trim();
  if (text === "") {
    return undefined;
  }
  const normalized = text.toLowerCase();
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
  return text;
}

function appendProcessText(
  pair: PsychiatristTranscriptPair,
  text: string,
): PsychiatristTranscriptPair {
  if (pair.process.at(-1) === text) {
    return pair;
  }
  if (pair.process.length < PSYCHIATRIST_MAX_PROCESS_ROWS_PER_PAIR) {
    return { ...pair, process: [...pair.process, text] };
  }
  const first = pair.process[0];
  return {
    ...pair,
    process: first === undefined
      ? [text]
      : [
          first,
          ...pair.process.slice(-(PSYCHIATRIST_MAX_PROCESS_ROWS_PER_PAIR - 2)),
          text,
        ],
  };
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

function readRetryMode(data: unknown): "first_answer" | "regenerate" | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  return data.retry_mode === "first_answer" || data.retry_mode === "regenerate"
    ? data.retry_mode
    : undefined;
}

function readRetryTurnId(data: unknown): string | undefined {
  return isRecord(data) && typeof data.retry_turn_id === "string"
    ? data.retry_turn_id
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
