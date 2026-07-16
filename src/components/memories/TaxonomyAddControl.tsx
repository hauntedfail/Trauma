import {
  For,
  Show,
  createMemo,
  createSignal,
  type JSX,
} from "solid-js";

import { PlusIcon } from "../icons";
import { Popup } from "../ui/Popup";
import {
  normalizeTaxonomyNameForLookup,
  validateTagName,
} from "../../taxonomy/name-policy";
import type {
  BrowseTaxonomyItem,
  BrowseTaxonomySummaryItem,
} from "./browse-data";
import {
  TaxonomyInlineCreateControl,
  normalizeTaxonomyAddName,
  type TaxonomyInlineCreateCloseReason,
} from "./TaxonomyInlineCreateControl";

export interface TaxonomyAddControlProps {
  attachedItems: readonly BrowseTaxonomyItem[];
  id: string;
  kind: "category" | "tag";
  options: readonly BrowseTaxonomySummaryItem[];
  triggerClass?: string;
  triggerRole?: JSX.ButtonHTMLAttributes<HTMLButtonElement>["role"];
  onAttachName: (name: string) => Promise<void> | void;
  onDetachName?: (name: string) => Promise<void> | void;
  onError?: (message: string) => void;
}

const addTaxonomyPillClass =
  "inline-flex items-center gap-1 rounded-full border border-dashed border-trauma-border-strong px-2.5 py-1 text-xs font-bold text-trauma-text-muted hover:text-trauma-text-primary";
const selectorPanelClass =
  "w-[min(300px,calc(100vw-2rem))] p-2 text-trauma-text-primary";
const selectorListClass =
  "flex max-h-[min(40vh,18rem)] flex-wrap items-center gap-x-1.5 gap-y-1.5 overflow-y-auto overscroll-contain p-1";
const optionClass =
  "rounded-full border border-trauma-chip-border bg-trauma-chip-bg px-2.5 py-1 text-xs font-bold text-trauma-chip-ink hover:border-trauma-border-strong hover:text-trauma-text-primary aria-pressed:border-trauma-accent aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink";

export function TaxonomyAddControl(props: TaxonomyAddControlProps) {
  let rootRef: HTMLDivElement | undefined;
  const [inlineInputOpen, setInlineInputOpen] = createSignal(false);
  const [pendingName, setPendingName] = createSignal("");
  const orderedOptions = createMemo(() =>
    sortTaxonomyOptionsByRecentUse(props.options),
  );
  const label = createMemo(() => getTaxonomyAddLabel(props.kind));
  const newLabel = createMemo(() => getTaxonomyNewLabel(props.kind));
  const triggerClass = createMemo(() => props.triggerClass ?? addTaxonomyPillClass);
  const cancelInlineInput = (
    reason?: TaxonomyInlineCreateCloseReason,
  ): void => {
    setInlineInputOpen(false);
    if (reason !== "outside-pointer") {
      restoreTaxonomyAddTriggerFocus(rootRef);
    }
  };

  const attachExistingOption = async (
    option: BrowseTaxonomySummaryItem,
  ): Promise<void> => {
    if (
      pendingName().length > 0 ||
      isTaxonomyNameAttached(props.attachedItems, option)
    ) {
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

  const detachExistingOption = async (
    option: BrowseTaxonomySummaryItem,
  ): Promise<void> => {
    if (pendingName().length > 0 || props.onDetachName === undefined) {
      return;
    }

    setPendingName(option.name);
    try {
      await props.onDetachName(option.name);
    } catch (error) {
      props.onError?.(readTaxonomyAddError(error));
    } finally {
      setPendingName("");
    }
  };

  const submitInlineInput = async (name: string): Promise<void> => {
    if (name === "" || pendingName().length > 0) {
      return;
    }

    const existingOption = findTaxonomyOptionByName(props.options, name);
    if (existingOption !== undefined) {
      if (isTaxonomyNameAttached(props.attachedItems, existingOption)) {
        return;
      }
      await attachExistingOption(existingOption);
      return;
    }

    setPendingName(name);
    try {
      await props.onAttachName(name);
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
    setInlineInputOpen(true);
  };

  return (
    <div ref={rootRef} class="relative inline-grid">
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
                      aria-pressed={isTaxonomyNameAttached(
                        props.attachedItems,
                        option,
                      )}
                      class={optionClass}
                      disabled={pendingName() === option.name}
                      title={option.name}
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (
                          props.onDetachName !== undefined &&
                          isTaxonomyNameAttached(props.attachedItems, option)
                        ) {
                          void detachExistingOption(option);
                          return;
                        }

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
        <TaxonomyInlineCreateControl
          class={triggerClass()}
          disabled={pendingName().length > 0}
          label={newLabel()}
          open={inlineInputOpen()}
          onError={props.onError}
          onOpenChange={(open, reason) => {
            if (!open) {
              cancelInlineInput(reason);
            }
          }}
          onSubmitName={submitInlineInput}
          validateName={props.kind === "tag" ? readTagNameValidationError : undefined}
        />
      </Show>
    </div>
  );
}

function restoreTaxonomyAddTriggerFocus(
  root: HTMLDivElement | undefined,
): void {
  queueMicrotask(() => {
    const trigger = root?.querySelector<HTMLButtonElement>(
      "[data-taxonomy-create-trigger]",
    );
    if (trigger?.isConnected === true && !trigger.disabled) {
      trigger.focus({ preventScroll: true });
    }
  });
}

export { normalizeTaxonomyAddName };

export function isTaxonomyNameAttached(
  attachedItems: readonly BrowseTaxonomyItem[],
  option: BrowseTaxonomySummaryItem,
): boolean {
  const optionName = normalizeTaxonomyNameForLookup(option.name);
  return attachedItems.some(
    (item) =>
      item.id === option.id ||
      normalizeTaxonomyNameForLookup(item.name) === optionName,
  );
}

export function findTaxonomyOptionByName(
  items: readonly BrowseTaxonomySummaryItem[],
  name: string,
): BrowseTaxonomySummaryItem | undefined {
  const normalizedName = normalizeTaxonomyLookupName(name);
  if (normalizedName === "") {
    return undefined;
  }

  return items.find(
    (item) => normalizeTaxonomyLookupName(item.name) === normalizedName,
  );
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

function normalizeTaxonomyLookupName(name: string): string {
  return normalizeTaxonomyNameForLookup(name);
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

function readTagNameValidationError(name: string): string | null {
  const result = validateTagName(name);
  return result.ok ? null : result.error;
}
