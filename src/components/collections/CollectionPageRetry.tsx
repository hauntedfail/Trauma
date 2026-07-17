import { createSignal } from "solid-js";

export function CollectionPageRetry(props: {
  getFocusTarget: () => HTMLElement | undefined;
  onRetry: () => Promise<unknown> | unknown;
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
    try {
      await props.onRetry();
    } catch {
      // The owning page keeps its existing error state available for another retry.
    } finally {
      setPending(false);
      queueMicrotask(() => {
        if (!shouldRestoreFocus()) {
          return;
        }
        const target = props.getFocusTarget();
        if (target?.isConnected) {
          target.focus({ preventScroll: true });
        }
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
