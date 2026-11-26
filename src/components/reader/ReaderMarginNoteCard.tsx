import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import type {
  AgentAskAction,
  AgentAskResponse,
} from "../../server/agent-api/types";
import type { SupportedLanguageCode } from "../../settings/languages";
import type { FetchFunction } from "../memories/memory-action-requests";
import { useDismissableLayer } from "../ui/dismissable-layer";
import { AdaptiveAiResponse } from "../../plugins";
import { parsePsychiatristStreamEvent } from "./psychiatrist-stream-events";
import type {
  PsychiatristStreamEvent,
  PsychiatristStreamEventType,
} from "./psychiatrist-types";

export type MarginNoteAction = AgentAskAction;

export type MarginNotePhase =
  | "input"
  | "submitting"
  | "streaming"
  | "completed"
  | "error";

export interface ReaderMarginNoteRequest {
  action: MarginNoteAction;
  requestId: number;
  selectedText?: string;
  sectionAnchor?: string;
  sectionTitle?: string;
  prompt?: string;
}

export interface MarginNoteStreamState {
  action: MarginNoteAction;
  answer: string;
  errorMessage: string;
  pairId?: string;
  phase: MarginNotePhase;
  statusText: string;
  threadId?: string;
  turnId?: string;
}

export interface EventSourceLike {
  addEventListener: (
    type: string,
    listener: (event: MessageEvent) => void,
  ) => void;
  close: () => void;
  onerror: ((event: Event) => void) | null;
  readyState: number;
}

export interface ReaderMarginNoteCardProps {
  createEventSource?: (url: string) => EventSourceLike;
  fetchFn?: FetchFunction;
  langCode?: SupportedLanguageCode;
  memoryId: string;
  onClose: () => void;
  onContinueInPsychiatrist: () => void;
  request: ReaderMarginNoteRequest;
}

export const MARGIN_NOTE_MAX_SELECTED_TEXT_CHARS = 2_000;
export const MARGIN_NOTE_MAX_PROMPT_CHARS = 2_000;
const EVENT_SOURCE_CLOSED_STATE = 2;

export function formatMarginNoteActionLabel(
  action: MarginNoteAction,
): "Simplified" | "Explained" | "Answer" {
  switch (action) {
    case "simplify":
      return "Simplified";
    case "explain":
      return "Explained";
    case "ask":
      return "Answer";
  }
}

export function formatMarginNotePassageSnippet(
  text: string | undefined,
  maxChars = 160,
): string {
  if (text === undefined) {
    return "";
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function buildReaderMarginNoteAskPayload(input: {
  action: MarginNoteAction;
  langCode?: SupportedLanguageCode;
  prompt?: string;
  resumeLatest?: boolean;
  sectionAnchor?: string;
  sectionTitle?: string;
  selectedText?: string;
}): Record<string, unknown> {
  const selectedText = trimAndCap(
    input.selectedText,
    MARGIN_NOTE_MAX_SELECTED_TEXT_CHARS,
  );
  const sectionAnchor = trimAndCap(input.sectionAnchor, 256);
  const sectionTitle = trimAndCap(input.sectionTitle, 512);
  const prompt = trimAndCap(input.prompt, MARGIN_NOTE_MAX_PROMPT_CHARS);

  if (input.action === "ask" && prompt === undefined) {
    throw new Error('Prompt is required when action is "ask".');
  }

  return {
    action: input.action,
    ...(selectedText === undefined ? {} : { selectedText }),
    ...(sectionAnchor === undefined ? {} : { sectionAnchor }),
    ...(sectionTitle === undefined ? {} : { sectionTitle }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(input.langCode === undefined ? {} : { langCode: input.langCode }),
    resumeLatest: input.resumeLatest ?? true,
  };
}

export function createInitialMarginNoteState(
  action: MarginNoteAction,
  hasInitialPrompt = false,
): MarginNoteStreamState {
  if (action === "ask" && !hasInitialPrompt) {
    return {
      action,
      answer: "",
      errorMessage: "",
      phase: "input",
      statusText: "",
    };
  }

  return {
    action,
    answer: "",
    errorMessage: "",
    phase: "submitting",
    statusText: "Thinking…",
  };
}

export function reduceMarginNoteStreamEvent(
  state: MarginNoteStreamState,
  event: PsychiatristStreamEvent,
): MarginNoteStreamState {
  const data = isRecord(event.data) ? event.data : undefined;

  switch (event.type) {
    case "psychiatrist.turn.started":
    case "psychiatrist.regenerate.started":
      return {
        ...state,
        errorMessage: "",
        phase: "streaming",
        statusText: state.answer.length > 0 ? "" : "Thinking…",
      };
    case "psychiatrist.process.delta": {
      const text = readNonEmptyString(data?.text);
      if (text === undefined || state.answer.length > 0) {
        return state;
      }
      return {
        ...state,
        phase: "streaming",
        statusText: text,
      };
    }
    case "psychiatrist.answer.delta": {
      const delta = typeof data?.text === "string" ? data.text : "";
      return {
        ...state,
        answer: `${state.answer}${delta}`,
        errorMessage: "",
        phase: "streaming",
        statusText: "",
      };
    }
    case "psychiatrist.answer.completed":
    case "psychiatrist.regenerate.completed": {
      const finalText = typeof data?.text === "string" ? data.text : state.answer;
      return {
        ...state,
        answer: finalText,
        errorMessage: "",
        phase: "completed",
        statusText: "",
      };
    }
    case "psychiatrist.answer.failed": {
      const message =
        readNonEmptyString(data?.message) ??
        "Psychiatrist could not answer right now.";
      return {
        ...state,
        errorMessage: message,
        phase: "error",
        statusText: "",
      };
    }
    case "psychiatrist.turn.canceled":
      return {
        ...state,
        errorMessage: "Request was canceled.",
        phase: "error",
        statusText: "",
      };
    case "psychiatrist.network.permission_required": {
      const message =
        readNonEmptyString(data?.message) ??
        "This question needs web sources. Continue in Psychiatrist to allow web access.";
      return {
        ...state,
        errorMessage: message,
        phase: "error",
        statusText: "",
      };
    }
  }
}

export async function submitReaderMarginNoteAsk(input: {
  fetch?: FetchFunction;
  memoryId: string;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<AgentAskResponse> {
  const fetchFn = input.fetch ?? fetch;
  const response = await fetchFn(
    `/api/agent/v1/memories/${encodeURIComponent(input.memoryId)}/ask`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input.payload),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );

  if (!response.ok) {
    throw new Error(await readAskErrorMessage(response));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Psychiatrist returned an unreadable response.");
  }

  if (!isAgentAskResponse(body)) {
    throw new Error("Psychiatrist returned an unexpected response.");
  }

  return body;
}

export function connectReaderMarginNoteStream(input: {
  createEventSource?: (url: string) => EventSourceLike;
  eventsUrl: string;
  memoryId: string;
  onEvent: (event: PsychiatristStreamEvent) => void;
  onStreamError: (message: string) => void;
  threadId: string;
  turnId: string;
}): () => void {
  const createSource =
    input.createEventSource ??
    ((url: string): EventSourceLike => {
      if (typeof EventSource === "undefined") {
        throw new Error("Streaming is unavailable in this browser.");
      }
      return new EventSource(url);
    });

  const eventSource = createSource(input.eventsUrl);
  let terminalObserved = false;

  const handleMessage =
    (eventType: PsychiatristStreamEventType, terminal = false) =>
    (message: MessageEvent) => {
      if (terminal) {
        if (terminalObserved) {
          return;
        }
        terminalObserved = true;
        eventSource.close();
      }
      const parsed = parsePsychiatristStreamEvent(message.data, {
        eventType,
        memoryId: input.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
      });
      if (parsed === undefined) {
        if (terminal) {
          input.onStreamError("Psychiatrist stream ended unexpectedly.");
        }
        return;
      }
      input.onEvent(parsed);
    };

  eventSource.addEventListener(
    "psychiatrist.turn.started",
    handleMessage("psychiatrist.turn.started"),
  );
  eventSource.addEventListener(
    "psychiatrist.process.delta",
    handleMessage("psychiatrist.process.delta"),
  );
  eventSource.addEventListener(
    "psychiatrist.answer.delta",
    handleMessage("psychiatrist.answer.delta"),
  );
  eventSource.addEventListener(
    "psychiatrist.answer.completed",
    handleMessage("psychiatrist.answer.completed", true),
  );
  eventSource.addEventListener(
    "psychiatrist.regenerate.started",
    handleMessage("psychiatrist.regenerate.started"),
  );
  eventSource.addEventListener(
    "psychiatrist.regenerate.completed",
    handleMessage("psychiatrist.regenerate.completed", true),
  );
  eventSource.addEventListener(
    "psychiatrist.answer.failed",
    handleMessage("psychiatrist.answer.failed", true),
  );
  eventSource.addEventListener(
    "psychiatrist.network.permission_required",
    handleMessage("psychiatrist.network.permission_required", true),
  );
  eventSource.addEventListener(
    "psychiatrist.turn.canceled",
    handleMessage("psychiatrist.turn.canceled", true),
  );

  eventSource.onerror = () => {
    if (terminalObserved) {
      return;
    }
    if (eventSource.readyState === EVENT_SOURCE_CLOSED_STATE) {
      terminalObserved = true;
      eventSource.close();
      input.onStreamError("Connection to Psychiatrist was lost.");
    }
  };

  return () => {
    terminalObserved = true;
    eventSource.close();
  };
}

export function ReaderMarginNoteCard(props: ReaderMarginNoteCardProps) {
  let cardRef: HTMLElement | undefined;
  let promptInputRef: HTMLInputElement | undefined;
  let disconnectStream: (() => void) | undefined;
  let abortController: AbortController | undefined;
  let runGeneration = 0;

  const [state, setState] = createSignal<MarginNoteStreamState>(
    createInitialMarginNoteState(
      props.request.action,
      Boolean(props.request.prompt?.trim()),
    ),
  );
  const [promptInput, setPromptInput] = createSignal(props.request.prompt ?? "");
  const [lastSubmitted, setLastSubmitted] = createSignal<{
    action: MarginNoteAction;
    prompt?: string;
  }>({
    action: props.request.action,
    ...(props.request.prompt === undefined
      ? {}
      : { prompt: props.request.prompt }),
  });

  const actionLabel = createMemo(() =>
    formatMarginNoteActionLabel(state().action),
  );
  const passageSnippet = createMemo(() =>
    formatMarginNotePassageSnippet(props.request.selectedText),
  );
  const isBusy = () =>
    state().phase === "submitting" || state().phase === "streaming";

  const stopActiveRun = () => {
    runGeneration += 1;
    abortController?.abort();
    abortController = undefined;
    disconnectStream?.();
    disconnectStream = undefined;
  };

  useDismissableLayer({
    getRoot: () => cardRef,
    isEnabled: () => true,
    onDismiss: (reason) => {
      if (reason === "escape") {
        props.onClose();
      }
    },
    shouldIgnoreOutsidePointerDown: () => true,
  });

  const runAsk = async (
    action: MarginNoteAction,
    prompt?: string,
  ): Promise<void> => {
    stopActiveRun();
    const generation = runGeneration;
    const trimmedPrompt = prompt?.trim() || undefined;
    setLastSubmitted({
      action,
      ...(trimmedPrompt === undefined ? {} : { prompt: trimmedPrompt }),
    });
    setState(createInitialMarginNoteState(action, trimmedPrompt !== undefined));

    let payload: Record<string, unknown>;
    try {
      payload = buildReaderMarginNoteAskPayload({
        action,
        langCode: props.langCode,
        ...(trimmedPrompt === undefined ? {} : { prompt: trimmedPrompt }),
        sectionAnchor: props.request.sectionAnchor,
        sectionTitle: props.request.sectionTitle,
        selectedText: props.request.selectedText,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        errorMessage:
          error instanceof Error ? error.message : "Could not send request.",
        phase: "error",
        statusText: "",
      }));
      return;
    }

    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : undefined;
    abortController = controller;

    try {
      const response = await submitReaderMarginNoteAsk({
        fetch: props.fetchFn,
        memoryId: props.memoryId,
        payload,
        signal: controller?.signal,
      });
      if (generation !== runGeneration) {
        return;
      }

      setState((current) => ({
        ...current,
        pairId: response.pairId,
        phase: "streaming",
        statusText: "Thinking…",
        threadId: response.threadId,
        turnId: response.turnId,
      }));

      disconnectStream = connectReaderMarginNoteStream({
        createEventSource: props.createEventSource,
        eventsUrl: response.eventsUrl,
        memoryId: props.memoryId,
        onEvent: (event) => {
          if (generation !== runGeneration) {
            return;
          }
          setState((current) => reduceMarginNoteStreamEvent(current, event));
        },
        onStreamError: (message) => {
          if (generation !== runGeneration) {
            return;
          }
          setState((current) => ({
            ...current,
            errorMessage: message,
            phase: "error",
            statusText: "",
          }));
        },
        threadId: response.threadId,
        turnId: response.turnId,
      });
    } catch (error) {
      if (generation !== runGeneration) {
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setState((current) => ({
        ...current,
        errorMessage:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Psychiatrist is currently unavailable.",
        phase: "error",
        statusText: "",
      }));
    }
  };

  createEffect(() => {
    const req = props.request;
    const initialPrompt = req.prompt?.trim() || undefined;
    setPromptInput(initialPrompt ?? "");

    if (req.action === "ask" && initialPrompt === undefined) {
      stopActiveRun();
      setLastSubmitted({ action: "ask" });
      setState(createInitialMarginNoteState("ask", false));
      queueMicrotask(() => {
        if (promptInputRef?.isConnected) {
          promptInputRef.focus({ preventScroll: true });
        }
      });
      return;
    }

    void runAsk(req.action, initialPrompt);
  });

  onCleanup(() => {
    stopActiveRun();
  });

  const handlePromptSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = promptInput().trim();
    if (trimmed.length === 0 || isBusy()) {
      return;
    }
    setPromptInput("");
    void runAsk("ask", trimmed);
  };

  const handleRetry = () => {
    const last = lastSubmitted();
    if (last.action === "ask" && !last.prompt) {
      setState(createInitialMarginNoteState("ask", false));
      return;
    }
    void runAsk(last.action, last.prompt);
  };

  return (
    <aside
      ref={cardRef}
      aria-label={`${actionLabel()} margin note`}
      class="trauma-reader-margin-note inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex max-h-[min(62dvh,26rem)] flex-col overflow-hidden rounded-2xl border border-trauma-border bg-trauma-bg-elev text-trauma-text-primary shadow-trauma-drawer md:inset-x-auto md:bottom-auto md:top-[4.5rem] md:end-5 md:w-[min(320px,calc(100vw-2rem))] md:max-h-[calc(100dvh-6rem)]"
      data-margin-note-action={state().action}
      data-margin-note-phase={state().phase}
      data-reader-margin-note=""
      role="complementary"
    >
      <header class="flex items-center justify-between gap-2 border-b border-trauma-divider px-3.5 py-2.5">
        <span
          class="inline-flex items-center rounded-full bg-trauma-bg-tint px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-trauma-text-primary"
          data-margin-note-label=""
        >
          {actionLabel()}
        </span>
        <button
          aria-label="Close margin note"
          class="trauma-tool trauma-tool-compact"
          data-margin-note-close=""
          title="Close (Esc)"
          type="button"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3">
        <Show when={passageSnippet().length > 0}>
          <blockquote
            class="border-l-2 border-trauma-border-strong pl-2.5 text-xs leading-relaxed text-trauma-text-muted"
            data-margin-note-quote=""
          >
            <p class="m-0 italic">“{passageSnippet()}”</p>
            <Show when={props.request.sectionTitle}>
              {(title) => (
                <footer class="mt-1 text-[11px] font-semibold not-italic text-trauma-text-muted">
                  {title()}
                </footer>
              )}
            </Show>
          </blockquote>
        </Show>

        <Show when={state().phase === "submitting"}>
          <p
            aria-live="polite"
            class="m-0 text-xs font-medium text-trauma-text-muted"
            data-margin-note-status=""
            role="status"
          >
            {state().statusText || "Thinking…"}
          </p>
        </Show>

        <Show when={state().phase === "streaming"}>
          <Show
            when={state().answer.length > 0}
            fallback={
              <p
                aria-live="polite"
                class="m-0 text-xs font-medium text-trauma-text-muted"
                data-margin-note-status=""
                role="status"
              >
                {state().statusText || "Thinking…"}
              </p>
            }
          >
            <div
              aria-live="polite"
              class="whitespace-pre-wrap text-sm leading-relaxed text-trauma-text-primary"
              data-margin-note-answer=""
            >
              {state().answer}
            </div>
          </Show>
        </Show>

        <Show when={state().phase === "completed"}>
          <div
            class="text-sm leading-relaxed text-trauma-text-primary"
            data-margin-note-answer=""
          >
            <AdaptiveAiResponse text={state().answer} />
          </div>
        </Show>

        <Show when={state().phase === "error"}>
          <div
            class="space-y-2 rounded-xl border border-trauma-danger bg-trauma-bg-surface px-3 py-2.5 text-xs text-trauma-danger"
            data-margin-note-error=""
            role="alert"
          >
            <p class="m-0 font-semibold">{state().errorMessage}</p>
            <button
              class="trauma-control trauma-control-compact"
              data-margin-note-retry=""
              type="button"
              onClick={handleRetry}
            >
              Try again
            </button>
          </div>
        </Show>

        <Show when={state().phase === "input" || state().phase === "completed"}>
          <form
            class="flex items-center gap-1.5 pt-1"
            onSubmit={handlePromptSubmit}
          >
            <input
              ref={promptInputRef}
              aria-label={
                state().phase === "input"
                  ? "Ask about this passage"
                  : "Ask a follow-up question"
              }
              class="trauma-field min-w-0 flex-1 text-xs placeholder:text-trauma-text-muted"
              data-margin-note-input=""
              disabled={isBusy()}
              placeholder={
                state().phase === "input"
                  ? "Ask about this passage…"
                  : "Ask a follow-up…"
              }
              type="text"
              value={promptInput()}
              onInput={(event) => setPromptInput(event.currentTarget.value)}
            />
            <button
              class="trauma-control trauma-control-compact trauma-control-primary shrink-0"
              data-margin-note-submit=""
              disabled={isBusy() || promptInput().trim().length === 0}
              type="submit"
            >
              Ask
            </button>
          </form>
        </Show>
      </div>

      <footer class="flex items-center justify-between gap-2 border-t border-trauma-divider px-3.5 py-2">
        <button
          class="trauma-control trauma-control-compact trauma-control-quiet"
          data-margin-note-continue=""
          type="button"
          onClick={props.onContinueInPsychiatrist}
        >
          Continue in Psychiatrist
        </button>
      </footer>
    </aside>
  );
}

function trimAndCap(
  value: string | undefined,
  maxChars: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAgentAskResponse(value: unknown): value is AgentAskResponse {
  return (
    isRecord(value) &&
    readNonEmptyString(value.threadId) !== undefined &&
    readNonEmptyString(value.turnId) !== undefined &&
    readNonEmptyString(value.pairId) !== undefined &&
    readNonEmptyString(value.eventsUrl) !== undefined &&
    isRecord(value.groundedContext)
  );
}

async function readAskErrorMessage(response: Response): Promise<string> {
  const fallback =
    response.status === 503
      ? "Psychiatrist is currently unavailable."
      : "Could not reach Psychiatrist right now.";
  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body)) {
      const errorText =
        readNonEmptyString(body.error) ?? readNonEmptyString(body.message);
      if (errorText !== undefined) {
        return errorText;
      }
    }
  } catch {
    // Ignore unreadable error bodies and fall back to a friendly message.
  }
  return fallback;
}
