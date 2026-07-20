import { Show, createSignal } from "solid-js";

import { TrashIcon } from "../icons";
import {
  KebabActionMenu,
  kebabActionMenuDangerItemClass,
  kebabActionMenuErrorClass,
  kebabActionMenuItemClass,
} from "../ui/KebabActionMenu";
import { ConfirmationPopup } from "../ui/ConfirmationPopup";
import { TaxonomyAddControl } from "./TaxonomyAddControl";
import type {
  BrowseTaxonomyItem,
  BrowseTaxonomySummaryItem,
} from "./browse-data";

export interface MemoryActionMenuProps {
  attachedCategories?: readonly BrowseTaxonomyItem[];
  categoryOptions?: readonly BrowseTaxonomySummaryItem[];
  memoryId: string;
  memoryTitle: string;
  onDelete?: (memoryId: string) => Promise<void> | void;
  onAttachCategoryByName?: (input: {
    memoryId: string;
    name: string;
  }) => Promise<void> | void;
  disabled?: boolean;
  class?: string;
  initialOpen?: boolean;
}

export function MemoryActionMenu(props: MemoryActionMenuProps) {
  const [error, setError] = createSignal("");

  const deleteMemory = async (): Promise<boolean> => {
    setError("");
    try {
      await props.onDelete?.(props.memoryId);
      return true;
    } catch {
      setError("Failed to delete memory.");
      return false;
    }
  };

  const submitCategory = async (name: string): Promise<void> => {
    setError("");
    try {
      await props.onAttachCategoryByName?.({
        memoryId: props.memoryId,
        name,
      });
    } catch (error) {
      setError("Failed to add category.");
      throw error;
    }
  };

  return (
    <KebabActionMenu
      class={props.class}
      disabled={props.disabled}
      id={`memory-${props.memoryId}-actions-menu`}
      initialOpen={props.initialOpen}
      label={`Memory actions for ${props.memoryTitle}`}
    >
      {({ close }) => (
        <>
          <ConfirmationPopup
            class="w-full"
            confirmLabel="Delete memory"
            description={`Delete memory "${props.memoryTitle}"? This action cannot be undone.`}
            disabled={props.disabled}
            id={`memory-${props.memoryId}-delete-confirmation`}
            label={`Delete memory ${props.memoryTitle} confirmation`}
            onConfirm={async () => {
              const deleted = await deleteMemory();
              if (deleted) {
                close();
              }
              return deleted;
            }}
            trigger={({ triggerProps }) => (
              <button
                {...triggerProps}
                class={`${kebabActionMenuDangerItemClass} w-full`}
                role="menuitem"
                type="button"
              >
                <TrashIcon />
                Delete memory
              </button>
            )}
          />
          <TaxonomyAddControl
            attachedItems={props.attachedCategories ?? []}
            id={`memory-${props.memoryId}-categories-add`}
            kind="category"
            options={props.categoryOptions ?? []}
            triggerClass={kebabActionMenuItemClass}
            triggerRole="menuitem"
            onAttachName={submitCategory}
            onError={(message) => setError(message)}
          />
          <Show when={error() !== ""}>
            <p class={kebabActionMenuErrorClass} role="alert">
              {error()}
            </p>
          </Show>
        </>
      )}
    </KebabActionMenu>
  );
}
