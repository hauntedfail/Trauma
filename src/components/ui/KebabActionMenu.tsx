import { type JSX } from "solid-js";

import { KebabIcon } from "../icons";
import { Popup } from "./Popup";

export interface KebabActionMenuControls {
  close: () => void;
}

export interface KebabActionMenuProps {
  children: (controls: KebabActionMenuControls) => JSX.Element;
  class?: string;
  disabled?: boolean;
  id: string;
  initialOpen?: boolean;
  label: string;
  onClose?: () => void;
}

const rootClass = "relative inline-grid";
const triggerClass =
  "grid size-9 place-items-center rounded-full text-trauma-text-muted transition-colors hover:bg-trauma-bg-elev hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent disabled:opacity-50";
const menuPanelClass =
  "grid min-w-[196px] gap-0.5 p-1.5 text-[13px] font-medium text-trauma-text-primary";

export const kebabActionMenuItemClass =
  "grid min-h-9 grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-xl px-2.5 text-left transition-colors hover:bg-trauma-bg-tint focus-visible:bg-trauma-bg-tint focus-visible:outline-none";

export const kebabActionMenuDangerItemClass = `${kebabActionMenuItemClass} text-trauma-danger hover:bg-trauma-danger/10`;

export const kebabActionMenuErrorClass =
  "mb-0 px-2.5 py-1 text-xs font-medium text-trauma-danger";

export function KebabActionMenu(props: KebabActionMenuProps) {
  return (
    <Popup
      class={`${rootClass} ${props.class ?? ""}`}
      disabled={props.disabled}
      id={props.id}
      initialOpen={props.initialOpen}
      label={props.label}
      mode="menu"
      panelClass={menuPanelClass}
      placement="bottom-end"
      onClose={props.onClose}
      trigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          aria-label={props.label}
          class={triggerClass}
          title={props.label}
          type="button"
        >
          <KebabIcon />
        </button>
      )}
    >
      {({ close }) => props.children({ close })}
    </Popup>
  );
}
