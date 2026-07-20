import { createSignal } from "solid-js";

export type CollectionPageRetryOutcome = "error" | "success" | "superseded";

export function CollectionPageRetry(props: {
  getFocusTarget: () => HTMLElement | undefined;
  onRetry: () => CollectionPageRetryOutcome | Promise<CollectionPageRetryOutcome>;
  subject: string;
}) {
  const [pending, setPending] = createSignal(false);
  let retryButton!: HTMLButtonElement;

  const retry = async (): Promise<void> => {
    if (pending()) {
      return;
    }

    const shouldRestoreFocus = captureCollectionPageRetryFocusIntent(retryButton);
    setPending(true);
    let outcome: CollectionPageRetryOutcome = "error";
    try {
      outcome = await props.onRetry();
    } catch {
      outcome = "error";
    } finally {
      setPending(false);
      queueMicrotask(() => {
        restoreCollectionPageRetryFocus({
          focusTarget: props.getFocusTarget(),
          outcome,
          retryButton,
          shouldRestoreFocus,
        });
      });
    }
  };

  return (
    <button
      ref={retryButton}
      aria-busy={pending()}
      aria-label={pending() ? `Retrying ${props.subject}...` : `Retry ${props.subject}`}
      class="mt-4 rounded-full border border-trauma-border px-4 py-2 text-sm font-bold text-trauma-text-primary transition hover:bg-trauma-bg-tint disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending()}
      onClick={() => void retry()}
      type="button"
    >
      {pending() ? "Retrying..." : "Retry"}
    </button>
  );
}

export function captureCollectionPageRetryFocusIntent(
  retryButton: HTMLButtonElement,
  readActiveElement: () => Element | null = () => document.activeElement,
  readBody: () => HTMLElement | null = () => document.body,
): () => boolean {
  const retryOwnedFocus = readActiveElement() === retryButton;
  return () =>
    retryOwnedFocus &&
    (readActiveElement() === retryButton || readActiveElement() === readBody());
}

export function restoreCollectionPageRetryFocus(input: {
  focusTarget: HTMLElement | undefined;
  outcome: CollectionPageRetryOutcome;
  retryButton: HTMLButtonElement;
  shouldRestoreFocus: () => boolean;
}): void {
  if (!input.shouldRestoreFocus() || input.outcome === "superseded") {
    return;
  }

  const target = input.outcome === "success" ? input.focusTarget : input.retryButton;
  if (target?.isConnected) {
    target.focus({ preventScroll: true });
  }
}

export function createCollectionPageRetryController(input: {
  getCurrentCursor: () => string | null;
  isPageReady: (cursor: string | null) => boolean;
  revalidatePage: (cursor: string | null) => Promise<unknown> | unknown;
}) {
  let nextGeneration = 0;
  const [activeRetry, setActiveRetry] = createSignal<{
    cursor: string | null;
    generation: number;
  }>();

  const isRetryingCurrentPage = (): boolean =>
    activeRetry()?.cursor === input.getCurrentCursor();

  const retryCurrentPage = async (): Promise<CollectionPageRetryOutcome> => {
    const attempt = {
      cursor: input.getCurrentCursor(),
      generation: ++nextGeneration,
    };
    setActiveRetry(attempt);

    let revalidationFailed = false;
    try {
      await input.revalidatePage(attempt.cursor);
    } catch {
      revalidationFailed = true;
    }

    const ownsRetry = activeRetry()?.generation === attempt.generation;
    const outcome: CollectionPageRetryOutcome = !ownsRetry ||
        input.getCurrentCursor() !== attempt.cursor
      ? "superseded"
      : !revalidationFailed && input.isPageReady(attempt.cursor)
        ? "success"
        : "error";

    if (ownsRetry) {
      setActiveRetry(undefined);
    }
    return outcome;
  };

  return {
    isRetryingCurrentPage,
    retryCurrentPage,
  };
}
