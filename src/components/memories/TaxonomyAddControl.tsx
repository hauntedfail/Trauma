import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";

import { PlusIcon } from "../icons";
import { Popup } from "../ui/Popup";
import { useDismissableLayer } from "../ui/dismissable-layer";
import type {
  BrowseTaxonomyItem,
  BrowseTaxonomySummaryItem,
} from "./browse-data";

export interface TaxonomyAddControlProps {
  attachedItems: readonly BrowseTaxonomyItem[];
  id: string;
  kind: "category" | "tag";
  options: readonly BrowseTaxonomySummaryItem[];
  triggerClass?: string;
  triggerRole?: JSX.ButtonHTMLAttributes<HTMLButtonElement>["role"];
  onAttachName: (name: string) => Promise<void> | void;
  onError?: (message: string) => void;
}

const addTaxonomyPillClass =
  "inline-flex items-center gap-1 rounded-full border border-dashed border-trauma-border-strong px-2.5 py-1 text-xs font-bold text-trauma-text-muted hover:text-trauma-text-primary";
const addTaxonomyInputClass =
  "min-w-[1ch] max-w-24 border-0 bg-transparent p-0 text-xs font-bold text-trauma-text-muted outline-none ring-0 caret-trauma-text-primary focus:outline-none";
const selectorPanelClass =
  "w-[min(300px,calc(100vw-2rem))] text-trauma-text-primary";
const selectorListClass =
  "flex max-h-[min(40vh,18rem)] flex-wrap items-center gap-x-1.5 gap-y-1.5 overflow-y-auto overscroll-contain p-1";
const optionClass =
  "rounded-full border border-trauma-chip-border bg-trauma-chip-bg px-2.5 py-1 text-xs font-bold text-trauma-chip-ink hover:border-trauma-border-strong hover:text-trauma-text-primary aria-pressed:border-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink";

export function TaxonomyAddControl(props: TaxonomyAddControlProps) {
  let rootRef: HTMLSpanElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  const [inlineInputOpen, setInlineInputOpen] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");
  const [pendingName, setPendingName] = createSignal("");
  const orderedOptions = createMemo(() =>
    sortTaxonomyOptionsByRecentUse(props.options),
  );
  const attachedIds = createMemo(
    () => new Set(props.attachedItems.map((item) => item.id)),
  );
  const label = createMemo(() => getTaxonomyAddLabel(props.kind));
  const newLabel = createMemo(() => getTaxonomyNewLabel(props.kind));
  const triggerClass = createMemo(() => props.triggerClass ?? addTaxonomyPillClass);
  const cancelInlineInput = (): void => {
    setInlineInputOpen(false);
    setDraftName("");
  };

  createEffect(() => {
    if (!inlineInputOpen()) {
      return;
    }
    queueMicrotask(() => inputRef?.focus());
  });

  useDismissableLayer({
    getRoot: () => rootRef,
    isEnabled: inlineInputOpen,
    onDismiss: cancelInlineInput,
  });

  const attachExistingOption = async (
    option: BrowseTaxonomySummaryItem,
  ): Promise<void> => {
    if (pendingName().length > 0) {
      return;
    }

    setPendingName(option.name);
    try {
      await props.onAttachName(option.name);
    } catch (error) {
      props.onError?.(readTaxonomyAddError(error));
    } finally {
      setPendingName("");
    }
  };

  const submitInlineInput = async (): Promise<void> => {
    const name = normalizeTaxonomyAddName(draftName());
    if (name === "" || pendingName().length > 0) {
      return;
    }

    setPendingName(name);
    try {
      await props.onAttachName(name);
      cancelInlineInput();
    } catch (error) {
      props.onError?.(readTaxonomyAddError(error));
    } finally {
      setPendingName("");
    }
  };

  const enterInlineInput: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (
    event,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDraftName("");
    setInlineInputOpen(true);
  };

  const onInlineInputSubmit: JSX.EventHandler<
    HTMLFormElement,
    SubmitEvent
  > = (event) => {
    event.preventDefault();
    void submitInlineInput();
  };

  const handleInlineInputKeyDown: JSX.EventHandlerUnion<
    HTMLInputElement,
    KeyboardEvent
  > = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineInput();
    }
  };

  return (
    <span ref={rootRef} class="relative inline-grid">
      <Show
        when={inlineInputOpen()}
        fallback={
          <Popup
            id={props.id}
            label={label()}
            mode="dialog"
            panelClass={selectorPanelClass}
            placement="bottom-start"
            trigger={({ triggerProps }) => (
              <button
                {...triggerProps}
                class={triggerClass()}
                data-taxonomy-create-trigger
                role={props.triggerRole}
                title={label()}
                type="button"
              >
                <PlusIcon />
                {label()}
              </button>
            )}
          >
            {() => (
              <div class={selectorListClass}>
                <For each={orderedOptions()}>
                  {(option) => (
                    <button
                      aria-pressed={attachedIds().has(option.id)}
                      class={optionClass}
                      disabled={pendingName() === option.name}
                      title={option.name}
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void attachExistingOption(option);
                      }}
                    >
                      {getTaxonomyOptionLabel(props.kind, option.name)}
                    </button>
                  )}
                </For>
                <button
                  class={addTaxonomyPillClass}
                  data-taxonomy-create-trigger
                  title={newLabel()}
                  type="button"
                  onClick={(event) => enterInlineInput(event)}
                >
                  <PlusIcon />
                  {newLabel()}
                </button>
              </div>
            )}
          </Popup>
        }
      >
        <form
          class={triggerClass()}
          data-taxonomy-create-trigger
          onSubmit={onInlineInputSubmit}
        >
          <PlusIcon />
          <input
            ref={inputRef}
            aria-label={newLabel()}
            class={addTaxonomyInputClass}
            disabled={pendingName().length > 0}
            size={Math.max(1, draftName().length)}
            value={draftName()}
            onInput={(event) => setDraftName(event.currentTarget.value)}
            onKeyDown={handleInlineInputKeyDown}
          />
        </form>
      </Show>
    </span>
  );
}

export function normalizeTaxonomyAddName(name: string): string {
  return name.trim();
}

export function sortTaxonomyOptionsByRecentUse(
  items: readonly BrowseTaxonomySummaryItem[],
): BrowseTaxonomySummaryItem[] {
  return [...items].sort((left, right) => {
    const leftTime = readAssignedTime(left.lastAssignedAt);
    const rightTime = readAssignedTime(right.lastAssignedAt);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return left.name.localeCompare(right.name);
  });
}

function getTaxonomyAddLabel(kind: TaxonomyAddControlProps["kind"]): string {
  return kind === "tag" ? "Add tag" : "Add category";
}

function getTaxonomyNewLabel(kind: TaxonomyAddControlProps["kind"]): string {
  return kind === "tag" ? "New tag" : "New category";
}

function getTaxonomyOptionLabel(
  kind: TaxonomyAddControlProps["kind"],
  name: string,
): string {
  return kind === "tag" ? `#${name}` : name;
}

function readAssignedTime(value: string | null): number {
  if (value === null) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function readTaxonomyAddError(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to update taxonomy.";
}
