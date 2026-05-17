import { Show, createSignal, type JSX } from "solid-js";

import { KebabIcon } from "../icons";

export interface KebabActionMenuControls {
  close: () => void;
}

export interface KebabActionMenuProps {
  children: (controls: KebabActionMenuControls) => JSX.Element;
  class?: string;
  disabled?: boolean;
  initialOpen?: boolean;
  label: string;
  onClose?: () => void;
}

const rootClass = "relative inline-grid";
const triggerClass =
  "grid size-9 place-items-center rounded-full text-trauma-text-muted transition-colors hover:bg-trauma-bg-elev hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent disabled:opacity-50";
const menuClass =
  "absolute right-0 top-10 z-[60] grid min-w-[180px] gap-1 rounded-[20px] border border-trauma-border bg-trauma-bg-elev p-2 text-sm font-bold text-trauma-text-primary shadow-lg";

export const kebabActionMenuItemClass =
  "grid min-h-10 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-full px-3 text-left hover:bg-trauma-bg-tint";

export const kebabActionMenuErrorClass =
  "mb-0 px-3 py-1 text-xs text-trauma-danger";

export function KebabActionMenu(props: KebabActionMenuProps) {
  const [open, setOpen] = createSignal(props.initialOpen ?? false);
  const close = () => {
    props.onClose?.();
    setOpen(false);
  };

  return (
    <span
      class={`${rootClass} ${props.class ?? ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
        }
      }}
    >
      <button
        class={triggerClass}
        type="button"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={props.label}
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
          {props.children({ close })}
        </div>
      </Show>
    </span>
  );
}
