import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import {
  cancelPsychiatristTurn,
  createPsychiatristThread,
  getPsychiatristErrorMessage,
  PsychiatristRequestError,
  regeneratePsychiatristResponse,
  sendPsychiatristMessage,
} from "./psychiatrist-requests";
import type {
  PsychiatristStreamEvent,
  PsychiatristThreadResponse,
} from "./psychiatrist-types";
import {
  applyPsychiatristStreamEvent,
  toPsychiatristTranscriptPairs,
  type PsychiatristTranscriptPair,
} from "./psychiatrist-transcript";

interface PsychiatristDockProps {
  langCode?: string;
  memoryId: string;
}

export function PsychiatristDock(props: PsychiatristDockProps) {
  let triggerRef: HTMLButtonElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let disconnectPsychiatristStream: (() => void) | undefined;
  const [isOpen, setIsOpen] = createSignal(false);
  const [thread, setThread] = createSignal<PsychiatristThreadResponse>();
  const [transcriptPairs, setTranscriptPairs] = createSignal<
    PsychiatristTranscriptPair[]
  >([]);
  const [prompt, setPrompt] = createSignal("");
  const [isRunning, setIsRunning] = createSignal(false);
  const [runningTurnId, setRunningTurnId] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [webSourceRetryPrompt, setWebSourceRetryPrompt] = createSignal("");

  const pairs = () => transcriptPairs();
  const openDock = () => {
    setIsOpen(true);
    void loadThread();
    queueMicrotask(() => inputRef?.focus());
  };
  const closeDock = () => {
    setIsOpen(false);
    triggerRef?.focus();
  };
  const loadThread = async () => {
    try {
      const nextThread = await createPsychiatristThread({
        langCode: props.langCode,
        memoryId: props.memoryId,
        resumeLatest: true,
      });
      setThread(nextThread);
      setTranscriptPairs(toPsychiatristTranscriptPairs(nextThread.pairs));
      if (nextThread.active_turn !== null) {
        setIsRunning(true);
        setRunningTurnId(nextThread.active_turn.turn_id);
        disconnectPsychiatristStream?.();
        disconnectPsychiatristStream = connectPsychiatristStream(
          nextThread.active_turn.event_url,
          handleStreamEvent,
        );
      }
    } catch (error) {
      setErrorMessage(getPsychiatristErrorMessage(error));
    }
  };
  const submitPrompt = async (
    webSourcePermission: "deny" | "allow_for_this_turn" = "deny",
    promptOverride?: string,
  ) => {
    const message = (promptOverride ?? prompt()).trim();
    const currentThread = thread();
    if (message === "" || currentThread === undefined || isRunning()) {
      return;
    }
    setIsRunning(true);
    setErrorMessage("");
    setWebSourceRetryPrompt("");
    try {
      const started = await sendPsychiatristMessage({
        clientMessageId: crypto.randomUUID(),
        message,
        threadId: currentThread.thread_id,
        webSourcePermission,
      });
      setTranscriptPairs((current) => [
        ...current,
        {
          answer: "",
          citations: [],
          pairId: started.pair_id,
          process: [],
          status: "running",
          turnId: started.turn_id,
          userPrompt: message,
        },
      ]);
      setPrompt("");
      setRunningTurnId(started.turn_id);
      disconnectPsychiatristStream?.();
      disconnectPsychiatristStream = connectPsychiatristStream(
        started.event_url,
        handleStreamEvent,
      );
    } catch (error) {
      setIsRunning(false);
      if (
        error instanceof PsychiatristRequestError &&
        error.code === "thread_stale" &&
        error.action === "refresh_thread"
      ) {
        await loadThread();
        setErrorMessage("Psychiatrist thread was refreshed. Send again.");
        queueMicrotask(() => inputRef?.focus());
        return;
      }
      if (
        error instanceof PsychiatristRequestError &&
        error.code === "network_permission_required"
      ) {
        setWebSourceRetryPrompt(message);
      }
      setErrorMessage(getPsychiatristErrorMessage(error));
    }
  };
  const approveWebSourcesForTurn = async () => {
    const retryPrompt = webSourceRetryPrompt();
    if (retryPrompt === "") {
      return;
    }
    setPrompt(retryPrompt);
    await submitPrompt("allow_for_this_turn", retryPrompt);
  };
  const handleStop = async () => {
    const turnId = runningTurnId();
    if (turnId === "") {
      return;
    }
    await cancelPsychiatristTurn({ turnId });
    setIsRunning(false);
  };
  const regeneratePair = async (pair: PsychiatristTranscriptPair) => {
    if (pair.status !== "completed" || isRunning()) {
      return;
    }
    setIsRunning(true);
    setErrorMessage("");
    try {
      const started = await regeneratePsychiatristResponse({
        pairId: pair.pairId,
        webSourcePermission: "deny",
      });
      setRunningTurnId(started.turn_id);
      disconnectPsychiatristStream?.();
      disconnectPsychiatristStream = connectPsychiatristStream(
        started.event_url,
        handleStreamEvent,
      );
    } catch (error) {
      setIsRunning(false);
      setErrorMessage(getPsychiatristErrorMessage(error));
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isOpen()) {
      return;
    }
    if (event.key === "Escape") {
      closeDock();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };
  const handleStreamEvent = (event: PsychiatristStreamEvent) => {
    const retryPrompt = event.type === "psychiatrist.network.permission_required"
      ? findPromptForStreamEvent(transcriptPairs(), event)
      : "";
    setTranscriptPairs((current) => applyPsychiatristStreamEvent(current, event));
    if (
      event.type === "psychiatrist.answer.completed" ||
      event.type === "psychiatrist.regenerate.completed" ||
      event.type === "psychiatrist.answer.failed" ||
      event.type === "psychiatrist.network.permission_required" ||
      event.type === "psychiatrist.turn.canceled"
    ) {
      setIsRunning(false);
      setRunningTurnId("");
      if (event.type === "psychiatrist.network.permission_required" && retryPrompt !== "") {
        setWebSourceRetryPrompt(retryPrompt);
        setErrorMessage("Allow web search/source lookup for this answer to continue.");
      }
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      disconnectPsychiatristStream?.();
    });
  });

  return (
    <div
      class="trauma-psychiatrist-dock fixed inset-x-0 bottom-4 z-[60] mx-auto grid w-[min(100%-1.5rem,26rem)] justify-items-center px-3 sm:bottom-6"
      data-psychiatrist-lang-code={props.langCode}
    >
      <style>{psychiatristDockStyles}</style>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open Psychiatrist"
        aria-expanded={isOpen()}
        class="h-8 w-32 rounded-full border border-trauma-border bg-trauma-text-primary/85 shadow-lg shadow-black/10 transition hover:bg-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trauma-focus"
        data-psychiatrist-dock="collapsed"
        onClick={openDock}
      />
      <Show when={isOpen()}>
        <section
          aria-label="Psychiatrist"
          class="trauma-psychiatrist-panel mt-3 grid max-h-[min(70vh,34rem)] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-3 rounded-lg border border-trauma-border bg-trauma-bg-elev p-3 text-trauma-text-primary shadow-xl"
          data-psychiatrist-dock="expanded"
        >
          <header class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">Psychiatrist</h2>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-xs text-trauma-text-secondary hover:bg-trauma-bg-sunken"
              onClick={closeDock}
            >
              Close
            </button>
          </header>
          <div class="grid gap-2 overflow-y-auto pr-1 text-sm" data-psychiatrist-transcript>
            <Show when={pairs().length > 0} fallback={<p class="text-trauma-text-secondary">No messages yet.</p>}>
              <For each={pairs()}>
                {(pair) => (
                  <article class="grid gap-1" data-psychiatrist-pair={pair.pairId}>
                    <p class="justify-self-end rounded-lg bg-trauma-accent px-3 py-2 text-trauma-accent-ink">
                      {pair.userPrompt}
                    </p>
                    <div class="justify-self-start rounded-lg bg-trauma-bg-sunken px-3 py-2 text-trauma-text-secondary">
                      <For each={pair.process}>
                        {(processText) => (
                          <p class="mb-1 text-xs text-trauma-text-muted" data-psychiatrist-process>
                            {processText}
                          </p>
                        )}
                      </For>
                      <Show
                        when={pair.answer}
                        fallback={<p class="text-xs uppercase tracking-[0.08em]">{pair.status}</p>}
                      >
                        {(response) => <p>{response()}</p>}
                      </Show>
                      <Show when={pair.citations.length > 0}>
                        <ul class="mt-2 grid gap-1 text-xs">
                          <For each={pair.citations}>
                            {(citation) => (
                              <li>
                                <a
                                  class="text-trauma-accent hover:underline"
                                  href={citation.url}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {citation.title}
                                </a>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <Show when={pair.status === "completed"}>
                        <button
                          type="button"
                          class="mt-2 rounded-md border border-trauma-border px-2 py-1 text-xs text-trauma-text-primary hover:bg-trauma-bg-elev"
                          onClick={() => void regeneratePair(pair)}
                        >
                          Regenerate
                        </button>
                      </Show>
                    </div>
                  </article>
                )}
              </For>
            </Show>
          </div>
          <form
            class="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt();
            }}
          >
            <textarea
              ref={inputRef}
              class="max-h-28 min-h-16 resize-y rounded-lg border border-trauma-border bg-trauma-bg-surface px-3 py-2 text-sm text-trauma-text-primary"
              disabled={isRunning()}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              value={prompt()}
            />
            <Show when={errorMessage() !== ""}>
              <div class="grid gap-2">
                <p class="text-xs text-trauma-danger">{errorMessage()}</p>
                <Show when={webSourceRetryPrompt() !== ""}>
                  <button
                    type="button"
                    class="justify-self-start rounded-md border border-trauma-border px-2 py-1 text-xs text-trauma-text-primary hover:bg-trauma-bg-elev"
                    onClick={() => void approveWebSourcesForTurn()}
                  >
                    Allow web sources for this turn
                  </button>
                </Show>
              </div>
            </Show>
            <button
              type={isRunning() ? "button" : "submit"}
              class="justify-self-end rounded-md bg-trauma-accent px-3 py-2 text-sm font-medium text-trauma-accent-ink hover:bg-trauma-accent-hover disabled:opacity-60"
              disabled={!isRunning() && prompt().trim() === ""}
              onClick={() => {
                if (isRunning()) {
                  void handleStop();
                }
              }}
            >
              {isRunning() ? "Stop" : "Send"}
            </button>
          </form>
        </section>
      </Show>
    </div>
  );
}

function connectPsychiatristStream(
  eventUrl: string,
  onEvent: (event: PsychiatristStreamEvent) => void,
): () => void {
  const eventSource = new EventSource(eventUrl);
  const handleMessage = (message: MessageEvent) => {
    const event = parsePsychiatristStreamEvent(message.data);
    if (event !== undefined) {
      onEvent(event);
    }
  };
  eventSource.addEventListener("psychiatrist.process.delta", handleMessage);
  eventSource.addEventListener("psychiatrist.answer.delta", handleMessage);
  eventSource.addEventListener("psychiatrist.answer.completed", (message) => {
    handleMessage(message);
    eventSource.close();
  });
  eventSource.addEventListener("psychiatrist.regenerate.started", handleMessage);
  eventSource.addEventListener("psychiatrist.regenerate.completed", (message) => {
    handleMessage(message);
    eventSource.close();
  });
  eventSource.addEventListener("psychiatrist.answer.failed", (message) => {
    handleMessage(message);
    eventSource.close();
  });
  eventSource.addEventListener("psychiatrist.network.permission_required", (message) => {
    handleMessage(message);
    eventSource.close();
  });
  eventSource.addEventListener("psychiatrist.turn.canceled", (message) => {
    handleMessage(message);
    eventSource.close();
  });
  return () => eventSource.close();
}

function findPromptForStreamEvent(
  pairs: readonly PsychiatristTranscriptPair[],
  event: PsychiatristStreamEvent,
): string {
  const pairId = readPairId(event.data);
  const pair = pairId === undefined
    ? pairs.find((candidate) => candidate.turnId === event.turnId)
    : pairs.find((candidate) => candidate.pairId === pairId);
  return pair?.userPrompt ?? "";
}

function readPairId(data: unknown): string | undefined {
  return isRecord(data) && typeof data.pair_id === "string" ? data.pair_id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePsychiatristStreamEvent(data: string): PsychiatristStreamEvent | undefined {
  try {
    const value = JSON.parse(data) as unknown;
    return isPsychiatristStreamEvent(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isPsychiatristStreamEvent(value: unknown): value is PsychiatristStreamEvent {
  return typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "turnId" in value &&
    typeof value.type === "string" &&
    typeof value.turnId === "string";
}

const psychiatristDockStyles = `
@media (prefers-reduced-motion: no-preference) {
  .trauma-psychiatrist-panel {
    animation: trauma-psychiatrist-expand 160ms ease-out;
    transform-origin: bottom center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trauma-psychiatrist-panel {
    animation: trauma-psychiatrist-fade 120ms ease-out;
  }
}

@keyframes trauma-psychiatrist-expand {
  from {
    opacity: 0;
    transform: translateY(0.75rem) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes trauma-psychiatrist-fade {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
`;
