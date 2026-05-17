import { Show, createSignal } from "solid-js";

import { PlusIcon } from "../icons";
import {
  KebabActionMenu,
  kebabActionMenuErrorClass,
  kebabActionMenuItemClass,
} from "../ui/KebabActionMenu";
import { TaxonomyCreatePopover } from "./TaxonomyCreatePopover";

export interface MemoryActionMenuProps {
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
  const [categoryOpen, setCategoryOpen] = createSignal(false);
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
    await props.onAttachCategoryByName?.({
      memoryId: props.memoryId,
      name,
    });
    setCategoryOpen(false);
  };

  return (
    <KebabActionMenu
      class={props.class}
      disabled={props.disabled}
      initialOpen={props.initialOpen}
      label={`Memory actions for ${props.memoryTitle}`}
      onClose={() => setCategoryOpen(false)}
    >
      {({ close }) => (
        <>
          <button
            class={kebabActionMenuItemClass}
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
            <span aria-hidden="true">-</span>
            Delete memory
          </button>
          <button
            class={kebabActionMenuItemClass}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setCategoryOpen(true);
            }}
          >
            <PlusIcon />
            Add category
          </button>
          <Show when={categoryOpen()}>
            <TaxonomyCreatePopover
              title="Add category"
              label="Category name"
              placeholder="Research"
              submitLabel="Add category"
              onSubmitName={async (name) => {
                await submitCategory(name);
                close();
              }}
              onClose={() => setCategoryOpen(false)}
            />
          </Show>
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
