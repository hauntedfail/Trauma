import {
  For,
  Show,
  createEffect,
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

interface ReaderRequestGeneration {
  readerGeneration: number;
  readerIdentity: string;
}

interface ThreadRequestGeneration extends ReaderRequestGeneration {
  threadIdentity: string;
}

interface StreamGeneration extends ThreadRequestGeneration {
  streamGeneration: number;
  threadId: string;
  turnId: string;
}

type PsychiatristThreadLoadState = "idle" | "loading" | "ready" | "error";
type PsychiatristTurnPhase = "idle" | "starting" | "running" | "stopping";

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
  const [threadLoadState, setThreadLoadState] =
    createSignal<PsychiatristThreadLoadState>("idle");
  const [turnPhase, setTurnPhase] = createSignal<PsychiatristTurnPhase>("idle");
  const [runningPairId, setRunningPairId] = createSignal("");
  const [runningTurnId, setRunningTurnId] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [liveStatusMessage, setLiveStatusMessage] = createSignal("");
  const [webSourceRetryPrompt, setWebSourceRetryPrompt] = createSignal("");
  const [webSourceRetryPairId, setWebSourceRetryPairId] = createSignal("");
  let isDisposed = false;
  let readerGeneration = 0;
  let streamGeneration = 0;
  let pendingStopTerminalStatus: "completed" | "failed" | undefined;
  let loadedReaderThreadKey = readPsychiatristReaderGenerationIdentity(
    props.memoryId,
    props.langCode,
  );

  const pairs = () => transcriptPairs();
  const isBusy = () => turnPhase() !== "idle";
  const openDock = () => {
    const request = captureReaderRequestGeneration();
    setIsOpen(true);
    if (threadLoadState() === "idle") {
      void loadThread();
    }
    queueMicrotask(() => {
      if (isCurrentReaderRequestGeneration(request)) {
        inputRef?.focus();
      }
    });
  };
  const closeDock = () => {
    setIsOpen(false);
    triggerRef?.focus();
  };
  const disconnectCurrentStream = () => {
    streamGeneration += 1;
    disconnectPsychiatristStream?.();
    disconnectPsychiatristStream = undefined;
  };
  const clearRunningTurnState = () => {
    disconnectCurrentStream();
    setTurnPhase("idle");
    setRunningPairId("");
    setRunningTurnId("");
  };
  const captureReaderRequestGeneration = (): ReaderRequestGeneration => ({
    readerGeneration,
    readerIdentity: readPsychiatristReaderGenerationIdentity(
      props.memoryId,
      props.langCode,
    ),
  });
  const isCurrentReaderRequestGeneration = (
    request: ReaderRequestGeneration,
  ): boolean => !isDisposed &&
    request.readerGeneration === readerGeneration &&
    request.readerIdentity === readPsychiatristReaderGenerationIdentity(
      props.memoryId,
      props.langCode,
    );
  const captureThreadRequestGeneration = (
    currentThread: PsychiatristThreadResponse,
  ): ThreadRequestGeneration => ({
    ...captureReaderRequestGeneration(),
    threadIdentity: readPsychiatristThreadIdentity(currentThread),
  });
  const isCurrentThreadRequestGeneration = (
    request: ThreadRequestGeneration,
  ): boolean => {
    const currentThread = thread();
    return isCurrentReaderRequestGeneration(request) &&
      currentThread !== undefined &&
      request.threadIdentity === readPsychiatristThreadIdentity(currentThread);
  };
  const clearWebSourceRetryState = () => {
    setWebSourceRetryPrompt("");
    setWebSourceRetryPairId("");
  };
  const syncPersistedWebSourceRetryState = (
    nextPairs: readonly PsychiatristTranscriptPair[],
  ) => {
    const retryPair = findPersistedWebSourceRetryPair(nextPairs);
    if (retryPair === undefined) {
      clearWebSourceRetryState();
      return;
    }
    setWebSourceRetryPrompt(retryPair.userPrompt);
    setWebSourceRetryPairId(retryPair.pairId);
    setErrorMessage("Allow web search/source lookup for this answer to continue.");
    setLiveStatusMessage("Allow web search/source lookup for this answer to continue.");
  };
  const resetThreadStateForMemoryChange = () => {
    clearRunningTurnState();
    pendingStopTerminalStatus = undefined;
    setThread(undefined);
    setThreadLoadState("idle");
    setTranscriptPairs([]);
    setPrompt("");
    setErrorMessage("");
    setLiveStatusMessage("");
    clearWebSourceRetryState();
  };
  const adoptRunningTurn = (nextThread: PsychiatristThreadResponse) => {
    const activeTurn = nextThread.active_turn;
    if (activeTurn === null) {
      return false;
    }
    clearWebSourceRetryState();
    setTurnPhase("running");
    setRunningPairId(activeTurn.pair_id);
    setRunningTurnId(activeTurn.turn_id);
    setLiveStatusMessage("Psychiatrist turn running.");
    connectRunningStream(
      activeTurn.event_url,
      nextThread,
      activeTurn.turn_id,
    );
    return true;
  };
  const loadThread = async (options: { preserveTurnPhase?: boolean } = {}) => {
    const request = captureReaderRequestGeneration();
    setThreadLoadState("loading");
    setErrorMessage("");
    setLiveStatusMessage("Loading Psychiatrist thread.");
    try {
      const nextThread = await createPsychiatristThread({
        langCode: props.langCode,
        memoryId: props.memoryId,
        resumeLatest: true,
      });
      if (
        !isCurrentReaderRequestGeneration(request) ||
        request.readerIdentity !== readPsychiatristReaderGenerationIdentity(
          nextThread.memory_id,
          nextThread.lang_code ?? undefined,
          nextThread.variant_kind,
        )
      ) {
        return;
      }
      const nextPairs = toPsychiatristTranscriptPairs(nextThread.pairs);
      setThread(nextThread);
      setTranscriptPairs(nextPairs);
      setThreadLoadState("ready");
      if (options.preserveTurnPhase === true) {
        syncPersistedWebSourceRetryState(nextPairs);
      } else if (nextThread.active_turn !== null) {
        adoptRunningTurn(nextThread);
      } else {
        clearRunningTurnState();
        setLiveStatusMessage("Psychiatrist thread ready.");
        syncPersistedWebSourceRetryState(nextPairs);
      }
      return nextThread;
    } catch (error) {
      if (!isCurrentReaderRequestGeneration(request)) {
        return false;
      }
      const message = getPsychiatristErrorMessage(error);
      setThreadLoadState("error");
      setErrorMessage(message);
      setLiveStatusMessage(message);
      return false;
    }
  };
  const submitPrompt = async (
    webSourcePermission: "deny" | "allow_for_this_turn" = "deny",
    promptOverride?: string,
  ) => {
    const message = (promptOverride ?? prompt()).trim();
    const currentThread = thread();
    if (
      message === "" ||
      currentThread === undefined ||
      threadLoadState() !== "ready" ||
      isBusy()
    ) {
      return;
    }
    const request = captureThreadRequestGeneration(currentThread);
    setTurnPhase("starting");
    setErrorMessage("");
    setLiveStatusMessage("Starting Psychiatrist turn.");
    try {
      const started = await sendPsychiatristMessage({
        langCode: currentThread.lang_code,
        memoryId: currentThread.memory_id,
        message,
        threadId: currentThread.thread_id,
        variantKind: currentThread.variant_kind,
        webSourcePermission,
      });
      if (!isCurrentThreadRequestGeneration(request)) {
        return;
      }
      clearWebSourceRetryState();
      setTurnPhase("running");
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
      setRunningPairId(started.pair_id);
      setRunningTurnId(started.turn_id);
      setLiveStatusMessage("Psychiatrist turn running.");
      connectRunningStream(
        started.event_url,
        currentThread,
        started.turn_id,
      );
    } catch (error) {
      if (!isCurrentThreadRequestGeneration(request)) {
        return;
      }
      setTurnPhase("idle");
      if (
        error instanceof PsychiatristRequestError &&
        error.code === "thread_stale" &&
        error.action === "refresh_thread"
      ) {
        await loadThread();
        if (!isCurrentReaderRequestGeneration(request)) {
          return;
        }
        setErrorMessage("Psychiatrist thread was refreshed. Send again.");
        setLiveStatusMessage("Psychiatrist thread was refreshed. Send again.");
        queueMicrotask(() => {
          if (isCurrentReaderRequestGeneration(request)) {
            inputRef?.focus();
          }
        });
        return;
      }
      if (
        error instanceof PsychiatristRequestError &&
        error.code === "network_permission_required"
      ) {
        setWebSourceRetryPrompt(message);
        setWebSourceRetryPairId("");
      }
      const errorText = getPsychiatristErrorMessage(error);
      if (webSourcePermission === "allow_for_this_turn") {
        const reloaded = await loadThread();
        if (!reloaded || !isCurrentThreadRequestGeneration(request)) {
          return;
        }
        if (turnPhase() === "running") {
          return;
        }
      }
      setErrorMessage(errorText);
      setLiveStatusMessage(errorText);
    }
  };
  const approveWebSourcesForTurn = async () => {
    const retryPrompt = webSourceRetryPrompt();
    if (retryPrompt === "") {
      return;
    }
    const retryPairId = webSourceRetryPairId();
    if (retryPairId !== "") {
      await regeneratePairById(retryPairId, "allow_for_this_turn");
      return;
    }
    setPrompt(retryPrompt);
    await submitPrompt("allow_for_this_turn", retryPrompt);
  };
  const handleStop = async () => {
    const turnId = runningTurnId();
    const pairId = runningPairId();
    const currentThread = thread();
    if (
      turnPhase() !== "running" ||
      turnId === "" ||
      pairId === "" ||
      currentThread === undefined
    ) {
      return;
    }
    const request = captureThreadRequestGeneration(currentThread);
    setTurnPhase("stopping");
    setErrorMessage("");
    setLiveStatusMessage("Stopping Psychiatrist turn.");
    try {
      const result = await cancelPsychiatristTurn({
        langCode: currentThread.lang_code,
        memoryId: currentThread.memory_id,
        pairId,
        threadId: currentThread.thread_id,
        turnId,
        variantKind: currentThread.variant_kind,
      });
      if (
        !isCurrentThreadRequestGeneration(request) ||
        runningPairId() !== pairId ||
        runningTurnId() !== turnId
      ) {
        return;
      }
      if (result.status === "canceled") {
        setTranscriptPairs((current) => applyPsychiatristStreamEvent(current, {
          data: { pair_id: pairId, status: "canceled" },
          eventId: `cancel:${turnId}`,
          memoryId: currentThread.memory_id,
          threadId: currentThread.thread_id,
          timestamp: Date.now(),
          turnId,
          type: "psychiatrist.turn.canceled",
        }));
        setLiveStatusMessage("Psychiatrist turn stopped.");
        clearRunningTurnState();
        return;
      }
      pendingStopTerminalStatus = result.status;
      const reloaded = await loadThread({ preserveTurnPhase: true });
      if (
        !reloaded ||
        !isCurrentThreadRequestGeneration(request) ||
        runningPairId() !== pairId ||
        runningTurnId() !== turnId
      ) {
        return;
      }
      pendingStopTerminalStatus = undefined;
      if (
        reloaded.active_turn !== null &&
        (
          reloaded.active_turn.pair_id !== pairId ||
          reloaded.active_turn.turn_id !== turnId
        )
      ) {
        adoptRunningTurn(reloaded);
        return;
      }
      if (webSourceRetryPrompt() === "") {
        setLiveStatusMessage(result.status === "completed"
          ? "Psychiatrist response completed."
          : "Psychiatrist response failed.");
      }
      clearRunningTurnState();
    } catch (error) {
      if (
        !isCurrentThreadRequestGeneration(request) ||
        turnPhase() !== "stopping" ||
        runningPairId() !== pairId ||
        runningTurnId() !== turnId
      ) {
        return;
      }
      const errorText = getPsychiatristErrorMessage(error);
      setTurnPhase("running");
      setErrorMessage(errorText);
      setLiveStatusMessage(errorText);
    }
  };
  const regeneratePair = async (pair: PsychiatristTranscriptPair) => {
    if (pair.status !== "completed" || isBusy()) {
      return;
    }
    await regeneratePairById(pair.pairId, "deny");
  };
  const regeneratePairById = async (
    pairId: string,
    webSourcePermission: "deny" | "allow_for_this_turn",
  ) => {
    const currentThread = thread();
    if (currentThread === undefined) {
      return;
    }
    const request = captureThreadRequestGeneration(currentThread);
    setTurnPhase("starting");
    setErrorMessage("");
    setLiveStatusMessage("Starting Psychiatrist regeneration.");
    try {
      const started = await regeneratePsychiatristResponse({
        langCode: currentThread.lang_code,
        memoryId: currentThread.memory_id,
        pairId,
        threadId: currentThread.thread_id,
        variantKind: currentThread.variant_kind,
        webSourcePermission,
      });
      if (!isCurrentThreadRequestGeneration(request)) {
        return;
      }
      clearWebSourceRetryState();
      setTurnPhase("running");
      setRunningPairId(started.pair_id);
      setRunningTurnId(started.turn_id);
      setLiveStatusMessage("Psychiatrist turn running.");
      connectRunningStream(
        started.event_url,
        currentThread,
        started.turn_id,
      );
    } catch (error) {
      if (!isCurrentThreadRequestGeneration(request)) {
        return;
      }
      setTurnPhase("idle");
      if (
        error instanceof PsychiatristRequestError &&
        error.code === "thread_stale" &&
        error.action === "refresh_thread"
      ) {
        await loadThread();
        if (!isCurrentReaderRequestGeneration(request)) {
          return;
        }
        setErrorMessage("Psychiatrist thread was refreshed. Regenerate again.");
        setLiveStatusMessage("Psychiatrist thread was refreshed. Regenerate again.");
        return;
      }
      const errorText = getPsychiatristErrorMessage(error);
      const reloaded = await loadThread();
      if (!reloaded || !isCurrentThreadRequestGeneration(request)) {
        return;
      }
      if (turnPhase() === "running") {
        return;
      }
      setErrorMessage(errorText);
      setLiveStatusMessage(errorText);
    }
  };
  const retryThreadLoad = async () => {
    if (threadLoadState() === "loading") {
      return;
    }
    if (turnPhase() !== "stopping" || pendingStopTerminalStatus === undefined) {
      await loadThread();
      return;
    }
    const pairId = runningPairId();
    const turnId = runningTurnId();
    const terminalStatus = pendingStopTerminalStatus;
    const reloaded = await loadThread({ preserveTurnPhase: true });
    if (!reloaded || runningPairId() !== pairId || runningTurnId() !== turnId) {
      return;
    }
    pendingStopTerminalStatus = undefined;
    if (
      reloaded.active_turn !== null &&
      (
        reloaded.active_turn.pair_id !== pairId ||
        reloaded.active_turn.turn_id !== turnId
      )
    ) {
      adoptRunningTurn(reloaded);
      return;
    }
    if (webSourceRetryPrompt() === "") {
      setLiveStatusMessage(terminalStatus === "completed"
        ? "Psychiatrist response completed."
        : "Psychiatrist response failed.");
    }
    clearRunningTurnState();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!isOpen()) {
      return;
    }
    if (event.key === "Escape") {
      closeDock();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && event.target === inputRef) {
      event.preventDefault();
      void submitPrompt();
    }
  };
  const handleStreamEvent = (
    event: PsychiatristStreamEvent,
    currentStream: StreamGeneration,
  ) => {
    if (
      !isCurrentThreadRequestGeneration(currentStream) ||
      currentStream.streamGeneration !== streamGeneration ||
      currentStream.threadId !== event.threadId ||
      currentStream.turnId !== event.turnId ||
      currentStream.turnId !== runningTurnId()
    ) {
      return;
    }
    const retryPrompt = event.type === "psychiatrist.network.permission_required"
      ? findPromptForStreamEvent(transcriptPairs(), event)
      : "";
    const retryPairId = event.type === "psychiatrist.network.permission_required"
      ? readPairId(event.data) ?? ""
      : "";
    setTranscriptPairs((current) => applyPsychiatristStreamEvent(current, event));
    if (
      event.type === "psychiatrist.answer.completed" ||
      event.type === "psychiatrist.regenerate.completed" ||
      event.type === "psychiatrist.answer.failed" ||
      event.type === "psychiatrist.network.permission_required" ||
      event.type === "psychiatrist.turn.canceled"
    ) {
      if (event.type === "psychiatrist.answer.failed") {
        const errorText = getStreamErrorMessage(event.data);
        setErrorMessage(errorText);
        setLiveStatusMessage(errorText);
      }
      if (event.type === "psychiatrist.network.permission_required" && retryPrompt !== "") {
        setWebSourceRetryPrompt(retryPrompt);
        setWebSourceRetryPairId(retryPairId);
        setErrorMessage("Allow web search/source lookup for this answer to continue.");
        setLiveStatusMessage("Allow web search/source lookup for this answer to continue.");
      }
      if (
        event.type === "psychiatrist.answer.completed" ||
        event.type === "psychiatrist.regenerate.completed"
      ) {
        setLiveStatusMessage("Psychiatrist response completed.");
      } else if (event.type === "psychiatrist.turn.canceled") {
        setLiveStatusMessage("Psychiatrist turn stopped.");
      }
      clearRunningTurnState();
    }
  };
  const connectRunningStream = (
    eventUrl: string,
    currentThread: PsychiatristThreadResponse,
    turnId: string,
  ) => {
    disconnectCurrentStream();
    const currentStream: StreamGeneration = {
      ...captureThreadRequestGeneration(currentThread),
      streamGeneration,
      threadId: currentThread.thread_id,
      turnId,
    };
    disconnectPsychiatristStream = connectPsychiatristStream(
      eventUrl,
      (event) => handleStreamEvent(event, currentStream),
    );
  };

  createEffect(() => {
    const nextReaderThreadKey = readPsychiatristReaderGenerationIdentity(
      props.memoryId,
      props.langCode,
    );
    if (nextReaderThreadKey === loadedReaderThreadKey) {
      return;
    }
    readerGeneration += 1;
    loadedReaderThreadKey = nextReaderThreadKey;
    resetThreadStateForMemoryChange();
    if (isOpen()) {
      void loadThread();
    }
  });

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      isDisposed = true;
      readerGeneration += 1;
      document.removeEventListener("keydown", handleKeyDown);
      disconnectCurrentStream();
    });
  });

  return (
    <div
      class="trauma-psychiatrist-dock fixed inset-x-0 bottom-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))] z-[60] mx-auto grid w-[min(100%-1.5rem,26rem)] justify-items-center px-3 min-[721px]:bottom-6"
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
          <p
            aria-atomic="true"
            aria-live="polite"
            class="sr-only"
            role="status"
          >
            {liveStatusMessage()}
          </p>
          <div class="grid gap-2 overflow-y-auto pr-1 text-sm" data-psychiatrist-transcript>
            <Show when={threadLoadState() === "loading"}>
              <p class="text-trauma-text-secondary">Loading Psychiatrist thread…</p>
            </Show>
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
                          class="mt-2 rounded-md border border-trauma-border px-2 py-1 text-xs text-trauma-text-primary hover:bg-trauma-bg-elev disabled:opacity-60"
                          disabled={isBusy()}
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
            <label class="sr-only" for="psychiatrist-prompt">Message Psychiatrist</label>
            <textarea
              id="psychiatrist-prompt"
              ref={inputRef}
              class="max-h-28 min-h-16 resize-y rounded-lg border border-trauma-border bg-trauma-bg-surface px-3 py-2 text-sm text-trauma-text-primary"
              disabled={threadLoadState() !== "ready" || isBusy()}
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
                    disabled={threadLoadState() !== "ready" || isBusy()}
                    onClick={() => void approveWebSourcesForTurn()}
                  >
                    Allow web sources for this turn
                  </button>
                </Show>
                <Show when={threadLoadState() === "error"}>
                  <button
                    type="button"
                    class="justify-self-start rounded-md border border-trauma-border px-2 py-1 text-xs text-trauma-text-primary hover:bg-trauma-bg-elev"
                    onClick={() => void retryThreadLoad()}
                  >
                    Retry thread load
                  </button>
                </Show>
              </div>
            </Show>
            <button
              type={turnPhase() === "idle" ? "submit" : "button"}
              class="justify-self-end rounded-md bg-trauma-accent px-3 py-2 text-sm font-medium text-trauma-accent-ink hover:bg-trauma-accent-hover disabled:opacity-60"
              disabled={
                threadLoadState() !== "ready" ||
                turnPhase() === "starting" ||
                turnPhase() === "stopping" ||
                (turnPhase() === "idle" && prompt().trim() === "")
              }
              onClick={() => {
                if (turnPhase() === "running") {
                  void handleStop();
                }
              }}
            >
              {turnPhase() === "starting"
                ? "Starting…"
                : turnPhase() === "running"
                ? "Stop"
                : turnPhase() === "stopping"
                ? "Stopping…"
                : "Send"}
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
  eventSource.addEventListener("psychiatrist.turn.started", handleMessage);
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

export function readPsychiatristReaderGenerationIdentity(
  memoryId: string,
  langCode: string | undefined,
  variantKind: "source" | "translation" = langCode === undefined
    ? "source"
    : "translation",
): string {
  return `${memoryId}\u0000${variantKind}\u0000${langCode ?? ""}`;
}

function readPsychiatristThreadIdentity(
  currentThread: PsychiatristThreadResponse,
): string {
  return `${readPsychiatristReaderGenerationIdentity(
    currentThread.memory_id,
    currentThread.lang_code ?? undefined,
    currentThread.variant_kind,
  )}\u0000${currentThread.thread_id}`;
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

export function findPersistedWebSourceRetryPair(
  pairs: readonly PsychiatristTranscriptPair[],
): PsychiatristTranscriptPair | undefined {
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index];
    if (pair?.retryAction === "allow_web_sources") {
      return pair;
    }
  }
  return undefined;
}

function readPairId(data: unknown): string | undefined {
  return isRecord(data) && typeof data.pair_id === "string" ? data.pair_id : undefined;
}

function getStreamErrorMessage(data: unknown): string {
  if (!isRecord(data) || typeof data.code !== "string") {
    return "Psychiatrist request failed.";
  }
  return getPsychiatristErrorMessage(new PsychiatristRequestError({
    action: typeof data.action === "string" ? data.action : "retry",
    code: data.code,
    message: typeof data.message === "string" ? data.message : "Psychiatrist request failed.",
    responseStatus: 500,
  }));
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
