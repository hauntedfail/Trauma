import { Show, createSignal } from "solid-js";

import { KebabIcon, PlusIcon } from "../icons";
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

const rootClass = "relative inline-grid";
const triggerClass =
  "grid size-9 place-items-center rounded-full text-trauma-text-muted transition-colors hover:bg-trauma-bg-elev hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent disabled:opacity-50";
const menuClass =
  "absolute right-0 top-10 z-[60] grid min-w-[180px] gap-1 rounded-[20px] border border-trauma-border bg-trauma-bg-elev p-2 text-sm font-bold text-trauma-text-primary shadow-lg";
const menuItemClass =
  "grid min-h-10 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-full px-3 text-left hover:bg-trauma-bg-tint";

export function MemoryActionMenu(props: MemoryActionMenuProps) {
  const [open, setOpen] = createSignal(props.initialOpen ?? false);
  const [categoryOpen, setCategoryOpen] = createSignal(false);
  const [error, setError] = createSignal("");

  const deleteMemory = async (): Promise<void> => {
    setError("");
    try {
      const deleted = await confirmAndDeleteMemory({
        memoryId: props.memoryId,
        memoryTitle: props.memoryTitle,
        confirm: (message) =>
          typeof window === "undefined" ? false : window.confirm(message),
        onDelete: props.onDelete,
      });
      if (deleted) {
        setOpen(false);
      }
    } catch {
      setError("Failed to delete memory.");
    }
  };

  const submitCategory = async (name: string): Promise<void> => {
    setError("");
    await props.onAttachCategoryByName?.({
      memoryId: props.memoryId,
      name,
    });
    setCategoryOpen(false);
    setOpen(false);
  };

  return (
    <span
      class={`${rootClass} ${props.class ?? ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setCategoryOpen(false);
          setOpen(false);
        }
      }}
    >
      <button
        class={triggerClass}
        type="button"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={`Memory actions for ${props.memoryTitle}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <KebabIcon />
      </button>
      <Show when={open()}>
        <div class={menuClass} role="menu">
          <button
            class={menuItemClass}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void deleteMemory();
            }}
          >
            <span aria-hidden="true">-</span>
            Delete memory
          </button>
          <button
            class={menuItemClass}
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
              onSubmitName={submitCategory}
              onClose={() => setCategoryOpen(false)}
            />
          </Show>
          <Show when={error() !== ""}>
            <p class="mb-0 px-3 py-1 text-xs text-trauma-danger">{error()}</p>
          </Show>
        </div>
      </Show>
    </span>
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
