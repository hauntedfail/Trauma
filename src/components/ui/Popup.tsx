import {
  Show,
  createEffect,
  createSignal,
  type JSX,
} from "solid-js";

import { useDismissableLayer } from "./dismissable-layer";

export interface PopupControls {
  close: () => void;
  open: boolean;
}

export interface PopupTriggerControls extends PopupControls {
  toggle: () => void;
  triggerProps: JSX.ButtonHTMLAttributes<HTMLButtonElement>;
}

export interface PopupProps {
  children: (controls: PopupControls) => JSX.Element;
  class?: string;
  disabled?: boolean;
  id: string;
  initialOpen?: boolean;
  label: string;
  mode?: "dialog" | "menu";
  panelClass?: string;
  phonePanel?: boolean;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  trigger: (controls: PopupTriggerControls) => JSX.Element;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}

const rootClass = "relative inline-grid";
const panelBaseClass =
  "z-[70] rounded-[20px] border border-trauma-border bg-trauma-bg-elev p-2 shadow-trauma-2 animate-trauma-pop-bounce";
const phonePanelClass =
  "fixed inset-x-3 bottom-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))] mx-auto w-[min(360px,calc(100vw-1.5rem))]";
const placementClass = {
  "bottom-start": "absolute left-0 top-full mt-1",
  "bottom-end": "absolute right-0 top-full mt-1",
  "top-start": "absolute bottom-full left-0 mb-1",
  "top-end": "absolute bottom-full right-0 mb-1",
} as const;

export function Popup(props: PopupProps) {
  let rootRef: HTMLSpanElement | undefined;
  let hasObservedOpenState = false;
  const [open, setOpen] = createSignal(props.initialOpen ?? false);
  const mode = () => props.mode ?? "dialog";
  const placement = () => props.placement ?? "bottom-start";
  const close = () => setOpen(false);
  const toggle = () => {
    if (props.disabled === true) {
      return;
    }
    setOpen((value) => !value);
  };

  createEffect(() => {
    const nextOpen = open();
    props.onOpenChange?.(nextOpen);
    if (hasObservedOpenState && !nextOpen) {
      props.onClose?.();
    }
    hasObservedOpenState = true;
  });

  useDismissableLayer({
    getRoot: () => rootRef,
    isEnabled: open,
    onDismiss: close,
  });

  const triggerProps = (): JSX.ButtonHTMLAttributes<HTMLButtonElement> => ({
    "aria-controls": open() ? props.id : undefined,
    "aria-expanded": open(),
    "aria-haspopup": mode(),
    disabled: props.disabled,
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    },
  });

  return (
    <span ref={rootRef} class={`${rootClass} ${props.class ?? ""}`}>
      {props.trigger({
        close,
        open: open(),
        toggle,
        triggerProps: triggerProps(),
      })}
      <Show when={open()}>
        <div
          aria-label={props.label}
          class={`${panelBaseClass} ${
            props.phonePanel === true ? phonePanelClass : placementClass[placement()]
          } ${props.panelClass ?? ""}`}
          id={props.id}
          role={mode()}
        >
          {props.children({ close, open: open() })}
        </div>
      </Show>
    </span>
  );
}
