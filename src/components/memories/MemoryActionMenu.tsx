import { Show, createSignal } from "solid-js";

import { TrashIcon } from "../icons";
import {
  KebabActionMenu,
  kebabActionMenuDangerItemClass,
  kebabActionMenuErrorClass,
  kebabActionMenuItemClass,
} from "../ui/KebabActionMenu";
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

export interface ConfirmAndDeleteMemoryInput {
  memoryId: string;
  memoryTitle?: string;
  confirm: (message: string) => boolean;
  onDelete?: (memoryId: string) => Promise<void> | void;
}

export function MemoryActionMenu(props: MemoryActionMenuProps) {
  const [error, setError] = createSignal("");

  const deleteMemory = async (): Promise<boolean> => {
    setError("");
    try {
      const deleted = await confirmAndDeleteMemory({
        memoryId: props.memoryId,
        memoryTitle: props.memoryTitle,
        confirm: (message) =>
          typeof window === "undefined" ? false : window.confirm(message),
        onDelete: props.onDelete,
      });
      return deleted;
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
          <button
            class={kebabActionMenuDangerItemClass}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void deleteMemory().then((deleted) => {
                if (deleted) {
                  close();
                }
              });
            }}
          >
            <TrashIcon />
            Delete memory
          </button>
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
            <p class={kebabActionMenuErrorClass}>{error()}</p>
          </Show>
        </>
      )}
    </KebabActionMenu>
  );
}

export async function confirmAndDeleteMemory(
  input: ConfirmAndDeleteMemoryInput,
): Promise<boolean> {
  const label = input.memoryTitle ?? input.memoryId;
  if (!input.confirm(`Delete memory "${label}"?`)) {
    return false;
  }

  await input.onDelete?.(input.memoryId);
  return true;
}
