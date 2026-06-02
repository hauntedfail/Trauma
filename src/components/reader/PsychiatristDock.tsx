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
  regeneratePsychiatristResponse,
  sendPsychiatristMessage,
} from "./psychiatrist-requests";
import type {
  PsychiatristThreadPairResponse,
  PsychiatristThreadResponse,
} from "./psychiatrist-types";

interface PsychiatristDockProps {
  langCode?: string;
  memoryId: string;
}

export function PsychiatristDock(props: PsychiatristDockProps) {
  let triggerRef: HTMLButtonElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  const [isOpen, setIsOpen] = createSignal(false);
  const [thread, setThread] = createSignal<PsychiatristThreadResponse>();
  const [prompt, setPrompt] = createSignal("");
  const [isRunning, setIsRunning] = createSignal(false);
  const [runningTurnId, setRunningTurnId] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");

  const pairs = () => thread()?.pairs ?? [];
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
      if (nextThread.active_turn !== null) {
        setIsRunning(true);
        setRunningTurnId(nextThread.active_turn.turn_id);
        connectPsychiatristStream(nextThread.active_turn.event_url);
      }
    } catch {
      setErrorMessage("Psychiatrist is unavailable.");
    }
  };
  const submitPrompt = async () => {
    const message = prompt().trim();
    const currentThread = thread();
    if (message === "" || currentThread === undefined || isRunning()) {
      return;
    }
    setPrompt("");
    setIsRunning(true);
    setErrorMessage("");
    try {
      const started = await sendPsychiatristMessage({
        clientMessageId: crypto.randomUUID(),
        message,
        threadId: currentThread.thread_id,
        webSourcePermission: "deny",
      });
      setRunningTurnId(started.turn_id);
      connectPsychiatristStream(started.event_url);
    } catch {
      setIsRunning(false);
      setErrorMessage("Psychiatrist could not send the prompt.");
    }
  };
  const handleStop = async () => {
    const turnId = runningTurnId();
    if (turnId === "") {
      return;
    }
    await cancelPsychiatristTurn({ turnId });
    setIsRunning(false);
  };
  const regeneratePair = async (pair: PsychiatristThreadPairResponse) => {
    if (pair.status !== "completed" || isRunning()) {
      return;
    }
    setIsRunning(true);
    setErrorMessage("");
    try {
      const started = await regeneratePsychiatristResponse({
        pairId: pair.pair_id,
        webSourcePermission: "deny",
      });
      setRunningTurnId(started.turn_id);
      connectPsychiatristStream(started.event_url);
    } catch {
      setIsRunning(false);
      setErrorMessage("Psychiatrist could not regenerate the response.");
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeDock();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
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
                  <article class="grid gap-1" data-psychiatrist-pair={pair.pair_id}>
                    <p class="justify-self-end rounded-lg bg-trauma-accent px-3 py-2 text-trauma-accent-ink">
                      {pair.user_prompt}
                    </p>
                    <div class="justify-self-start rounded-lg bg-trauma-bg-sunken px-3 py-2 text-trauma-text-secondary">
                      <Show
                        when={pair.assistant_response}
                        fallback={<p class="text-xs uppercase tracking-[0.08em]">{pair.status}</p>}
                      >
                        {(response) => <p>{response()}</p>}
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
              <p class="text-xs text-trauma-danger">{errorMessage()}</p>
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

function connectPsychiatristStream(eventUrl: string): void {
  const eventSource = new EventSource(eventUrl);
  eventSource.addEventListener("psychiatrist.answer.completed", () => {
    eventSource.close();
  });
  eventSource.addEventListener("psychiatrist.regenerate.completed", () => {
    eventSource.close();
  });
  eventSource.addEventListener("psychiatrist.answer.failed", () => {
    eventSource.close();
  });
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
