import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";

import { PlusIcon } from "../icons";
import {
  useDismissableLayer,
  type DismissableLayerDismissReason,
} from "../ui/dismissable-layer";
import { normalizeTaxonomyName } from "../../taxonomy/name-policy";

export type TaxonomyInlineCreateCloseReason =
  | DismissableLayerDismissReason
  | "submit";

export interface TaxonomyInlineCreateControlProps {
  class?: string;
  disabled?: boolean;
  label: string;
  open?: boolean;
  validateName?: (name: string) => string | null;
  onError?: (message: string) => void;
  onOpenChange?: (
    open: boolean,
    reason?: TaxonomyInlineCreateCloseReason,
  ) => void;
  onSubmitName: (name: string) => Promise<void> | void;
}

export function createTaxonomyOpenInstanceTracker() {
  let activeInstance: symbol | undefined;

  return {
    capture: () => {
      const capturedInstance = activeInstance;
      return () =>
        capturedInstance !== undefined && activeInstance === capturedInstance;
    },
    close: () => {
      activeInstance = undefined;
    },
    open: () => {
      activeInstance ??= Symbol("taxonomy-open-instance");
    },
  };
}

const addTaxonomyPillClass =
  "inline-flex items-center gap-1 rounded-full border border-dashed border-trauma-border-strong px-2.5 py-1 text-xs font-bold text-trauma-text-muted hover:text-trauma-text-primary";
const addTaxonomyInputClass =
  "min-w-[1ch] max-w-24 border-0 bg-transparent p-0 text-xs font-bold text-trauma-text-muted outline-none ring-0 caret-trauma-text-primary focus:outline-none";

export function TaxonomyInlineCreateControl(
  props: TaxonomyInlineCreateControlProps,
) {
  let rootRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const openInstanceTracker = createTaxonomyOpenInstanceTracker();
  const isOpen = () => props.open ?? internalOpen();
  const triggerClass = () => props.class ?? addTaxonomyPillClass;
  const setOpen = (
    open: boolean,
    reason?: TaxonomyInlineCreateCloseReason,
  ): void => {
    if (open) {
      openInstanceTracker.open();
    } else {
      openInstanceTracker.close();
    }
    if (props.open === undefined) {
      setInternalOpen(open);
    }
    props.onOpenChange?.(open, reason);
    if (!open) {
      setDraftName("");
      if (reason !== "outside-pointer") {
        restoreTaxonomyTriggerFocus(triggerRef);
      }
    }
  };

  createEffect(() => {
    if (!isOpen()) {
      openInstanceTracker.close();
      return;
    }
    openInstanceTracker.open();
    queueMicrotask(() => inputRef?.focus());
  });
  onCleanup(() => openInstanceTracker.close());

  useDismissableLayer({
    getRoot: () => rootRef,
    isEnabled: isOpen,
    onDismiss: (reason) => setOpen(false, reason),
  });

  const submit = async (): Promise<void> => {
    const name = normalizeTaxonomyAddName(draftName());
    if (name === "" || pending() || props.disabled === true) {
      return;
    }

    const validationError = props.validateName?.(name) ?? null;
    if (validationError !== null) {
      props.onError?.(validationError);
      return;
    }

    const submittingInstanceStillOwned = openInstanceTracker.capture();
    setPending(true);
    try {
      await props.onSubmitName(name);
      if (submittingInstanceStillOwned()) {
        setOpen(false, "submit");
      }
    } catch (error) {
      props.onError?.(
        error instanceof Error ? error.message : "Failed to update taxonomy.",
      );
    } finally {
      setPending(false);
    }
  };

  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, "escape");
    }
  };

  return (
    <div ref={rootRef} class="relative inline-grid">
      <Show
        when={isOpen()}
        fallback={
          <button
            ref={triggerRef}
            class={triggerClass()}
            data-taxonomy-create-trigger
            disabled={props.disabled}
            title={props.label}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
          >
            <PlusIcon />
            {props.label}
          </button>
        }
      >
        <form
          class={triggerClass()}
          data-taxonomy-create-trigger
          onSubmit={onSubmit}
        >
          <PlusIcon />
          <input
            ref={inputRef}
            aria-label={props.label}
            class={addTaxonomyInputClass}
            disabled={pending() || props.disabled === true}
            size={Math.max(1, draftName().length)}
            value={draftName()}
            onInput={(event) => setDraftName(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </form>
      </Show>
    </div>
  );
}

function restoreTaxonomyTriggerFocus(
  trigger: HTMLButtonElement | undefined,
): void {
  queueMicrotask(() => {
    if (trigger?.isConnected === true && !trigger.disabled) {
      trigger.focus({ preventScroll: true });
    }
  });
}

export const normalizeTaxonomyAddName = normalizeTaxonomyName;
