import { createSignal, onMount, type JSX } from "solid-js";

import { PlusIcon } from "../icons";
import { useDismissableLayer } from "../ui/dismissable-layer";

export interface TaxonomyCreatePopoverProps {
  title: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmitName: (name: string) => Promise<void> | void;
  onClose: () => void;
}

const popoverClass =
  "absolute z-[60] mt-2 w-[260px] rounded-[20px] border border-trauma-border bg-trauma-bg-elev p-3 text-trauma-text-primary shadow-lg";
const inputClass =
  "min-h-10 min-w-0 rounded-full border border-trauma-border bg-trauma-bg-surface px-3 text-sm outline-none focus:border-trauma-border-strong";
const submitButtonClass =
  "grid size-10 place-items-center rounded-full border border-trauma-border-strong bg-trauma-accent text-trauma-accent-ink";
const secondaryButtonClass =
  "rounded-full px-3 py-2 text-sm font-bold text-trauma-text-muted";

export function TaxonomyCreatePopover(props: TaxonomyCreatePopoverProps) {
  let rootRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);

  onMount(() => inputRef?.focus());
  useDismissableLayer({
    getRoot: () => rootRef,
    onDismiss: props.onClose,
  });

  const submit = async (): Promise<void> => {
    setPending(true);
    setError("");
    try {
      await submitTaxonomyName({
        name: name(),
        onSubmitName: props.onSubmitName,
      });
      props.onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "failed to submit name");
    } finally {
      setPending(false);
    }
  };

  const onSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    void submit();
  };

  return (
    <div
      ref={rootRef}
      class={popoverClass}
      role="dialog"
      aria-label={props.title}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          props.onClose();
        }
      }}
    >
      <form class="grid gap-3" onSubmit={onSubmit}>
        <div class="grid gap-1">
          <strong class="text-sm">{props.title}</strong>
          <label class="text-xs font-bold text-trauma-text-muted" for="taxonomy-create-name">
            {props.label}
          </label>
        </div>
        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <input
            ref={inputRef}
            id="taxonomy-create-name"
            class={inputClass}
            value={name()}
            placeholder={props.placeholder}
            disabled={pending()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <button
            class={submitButtonClass}
            type="submit"
            disabled={pending()}
            aria-label={props.submitLabel}
          >
            <PlusIcon />
          </button>
        </div>
        {error() !== "" ? (
          <p class="mb-0 text-xs font-bold text-trauma-danger">{error()}</p>
        ) : null}
        <button
          class={secondaryButtonClass}
          type="button"
          onClick={props.onClose}
        >
          Close
        </button>
      </form>
    </div>
  );
}

export function normalizeTaxonomyName(name: string): string {
  return name.trim();
}

export async function submitTaxonomyName(input: {
  name: string;
  onSubmitName: (name: string) => Promise<void> | void;
}): Promise<void> {
  const name = normalizeTaxonomyName(input.name);
  if (name === "") {
    throw new Error("name must be a non-empty string");
  }

  await input.onSubmitName(name);
}
