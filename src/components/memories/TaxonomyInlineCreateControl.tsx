import { Show, createEffect, createSignal, type JSX } from "solid-js";

import { PlusIcon } from "../icons";
import { useDismissableLayer } from "../ui/dismissable-layer";

export interface TaxonomyInlineCreateControlProps {
  class?: string;
  disabled?: boolean;
  label: string;
  open?: boolean;
  onError?: (message: string) => void;
  onOpenChange?: (open: boolean) => void;
  onSubmitName: (name: string) => Promise<void> | void;
}

const addTaxonomyPillClass =
  "inline-flex items-center gap-1 rounded-full border border-dashed border-trauma-border-strong px-2.5 py-1 text-xs font-bold text-trauma-text-muted hover:text-trauma-text-primary";
const addTaxonomyInputClass =
  "min-w-[1ch] max-w-24 border-0 bg-transparent p-0 text-xs font-bold text-trauma-text-muted outline-none ring-0 caret-trauma-text-primary focus:outline-none";

export function TaxonomyInlineCreateControl(
  props: TaxonomyInlineCreateControlProps,
) {
  let rootRef: HTMLSpanElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const isOpen = () => props.open ?? internalOpen();
  const triggerClass = () => props.class ?? addTaxonomyPillClass;
  const setOpen = (open: boolean): void => {
    if (props.open === undefined) {
      setInternalOpen(open);
    }
    props.onOpenChange?.(open);
    if (!open) {
      setDraftName("");
    }
  };

  createEffect(() => {
    if (!isOpen()) {
      return;
    }
    queueMicrotask(() => inputRef?.focus());
  });

  useDismissableLayer({
    getRoot: () => rootRef,
    isEnabled: isOpen,
    onDismiss: () => setOpen(false),
  });

  const submit = async (): Promise<void> => {
    const name = normalizeTaxonomyAddName(draftName());
    if (name === "" || pending() || props.disabled === true) {
      return;
    }

    setPending(true);
    try {
      await props.onSubmitName(name);
      setOpen(false);
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
      setOpen(false);
    }
  };

  return (
    <span ref={rootRef} class="relative inline-grid">
      <Show
        when={isOpen()}
        fallback={
          <button
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
    </span>
  );
}

export function normalizeTaxonomyAddName(name: string): string {
  return name.trim();
}
