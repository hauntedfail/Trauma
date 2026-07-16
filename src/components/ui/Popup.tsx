import {
  Show,
  createEffect,
  createSignal,
  untrack,
  type JSX,
} from "solid-js";

import {
  useDismissableLayer,
  type DismissableLayerDismissReason,
} from "./dismissable-layer";

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
  "z-[70] rounded-[20px] border border-trauma-border bg-trauma-bg-elev/50 shadow-trauma-2 backdrop-blur animate-trauma-pop-bounce";
const phonePanelClass =
  "fixed inset-x-3 bottom-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))] mx-auto w-[min(360px,calc(100vw-1.5rem))]";
const placementClass = {
  "bottom-start": "absolute left-0 top-full mt-1",
  "bottom-end": "absolute right-0 top-full mt-1",
  "top-start": "absolute bottom-full left-0 mb-1",
  "top-end": "absolute bottom-full right-0 mb-1",
} as const;

export function Popup(props: PopupProps) {
  let rootRef: HTMLDivElement | undefined;
  let activeTrigger: HTMLButtonElement | undefined;
  let activeTriggerIndex = 0;
  let hasObservedOpenState = false;
  const [open, setOpen] = createSignal(props.initialOpen ?? false);
  const mode = () => props.mode ?? "dialog";
  const placement = () => props.placement ?? "bottom-start";
  const closePopup = (restoreFocus: boolean): void => {
    setOpen(false);
    if (restoreFocus) {
      restorePopupTriggerFocus(activeTrigger, rootRef, activeTriggerIndex);
    }
  };
  const close = () => closePopup(true);
  const toggle = () => {
    if (props.disabled === true) {
      return;
    }
    if (open()) {
      closePopup(true);
      return;
    }

    setOpen(true);
  };

  createEffect(() => {
    const nextOpen = open();
    untrack(() => props.onOpenChange?.(nextOpen));
    if (hasObservedOpenState && !nextOpen) {
      untrack(() => props.onClose?.());
    }
    hasObservedOpenState = true;
  });

  useDismissableLayer({
    getRoot: () => rootRef,
    isEnabled: open,
    onDismiss: (reason: DismissableLayerDismissReason) =>
      closePopup(reason === "escape"),
  });

  const triggerProps = (): JSX.ButtonHTMLAttributes<HTMLButtonElement> => ({
    "aria-controls": open() ? props.id : undefined,
    "aria-expanded": open(),
    "aria-haspopup": mode(),
    disabled: props.disabled,
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      activeTrigger = event.currentTarget;
      activeTriggerIndex = rootRef === undefined
        ? 0
        : [...rootRef.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]")]
          .indexOf(activeTrigger);
      toggle();
    },
  });

  return (
    <div ref={rootRef} class={`${rootClass} ${props.class ?? ""}`}>
      {props.trigger({
        close,
        open: open(),
        toggle,
        triggerProps: triggerProps(),
      })}
      <Show when={open()}>
        <div
          ref={(panel) => focusPopupPanel(panel, mode())}
          aria-label={props.label}
          class={`${panelBaseClass} ${
            props.phonePanel === true ? phonePanelClass : placementClass[placement()]
          } ${props.panelClass ?? ""}`}
          id={props.id}
          role={mode()}
          tabIndex={-1}
          onFocusOut={(event) => {
            const panel = event.currentTarget;
            if (
              mode() === "menu" &&
              (!(event.relatedTarget instanceof Node) ||
                panel.contains(event.relatedTarget) !== true)
            ) {
              queueMicrotask(() => {
                if (open() && !panel.contains(document.activeElement)) {
                  closePopup(false);
                }
              });
            }
          }}
          onKeyDown={(event) => {
            if (mode() === "menu") {
              if (shouldReturnPopupMenuFocusOnBackwardTab(event)) {
                event.preventDefault();
                closePopup(true);
                return;
              }
              handlePopupMenuKeyDown(event);
            }
          }}
        >
          {props.children({ close, open: open() })}
        </div>
      </Show>
    </div>
  );
}

const popupFocusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusPopupPanel(
  panel: HTMLDivElement,
  mode: "dialog" | "menu",
): void {
  queueMicrotask(() => {
    if (!panel.isConnected) {
      return;
    }

    if (mode === "menu") {
      const items = getPopupMenuItems(panel);
      items.forEach((item, index) => {
        item.tabIndex = index === 0 ? 0 : -1;
      });
      (items[0] ?? panel).focus({ preventScroll: true });
      return;
    }

    (panel.querySelector<HTMLElement>(popupFocusableSelector) ?? panel).focus({
      preventScroll: true,
    });
  });
}

function restorePopupTriggerFocus(
  trigger: HTMLButtonElement | undefined,
  root: HTMLDivElement | undefined,
  triggerIndex: number,
): void {
  queueMicrotask(() => {
    const target = trigger?.isConnected === true
      ? trigger
      : root?.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]")[
        Math.max(triggerIndex, 0)
      ];
    if (target?.isConnected === true && !target.disabled) {
      target.focus({ preventScroll: true });
    }
  });
}

function handlePopupMenuKeyDown(event: KeyboardEvent): void {
  if (
    event.key !== "ArrowDown" &&
    event.key !== "ArrowUp" &&
    event.key !== "Home" &&
    event.key !== "End"
  ) {
    return;
  }

  const panel = event.currentTarget;
  if (!(panel instanceof HTMLDivElement)) {
    return;
  }

  const items = getPopupMenuItems(panel);
  if (items.length === 0) {
    return;
  }

  event.preventDefault();
  const activeIndex = items.findIndex((item) => item === document.activeElement);
  let nextIndex = 0;
  if (event.key === "End") {
    nextIndex = items.length - 1;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "ArrowDown") {
    nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
  }

  focusPopupMenuItem(items, nextIndex);
}

function shouldReturnPopupMenuFocusOnBackwardTab(
  event: KeyboardEvent,
): boolean {
  if (event.key !== "Tab" || !event.shiftKey) {
    return false;
  }

  const panel = event.currentTarget;
  if (!(panel instanceof HTMLDivElement)) {
    return false;
  }

  return getPopupMenuItems(panel)[0] === document.activeElement;
}

function getPopupMenuItems(panel: HTMLDivElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (item) =>
      item.getAttribute("aria-disabled") !== "true" &&
      (!(item instanceof HTMLButtonElement) || !item.disabled),
  );
}

function focusPopupMenuItem(items: HTMLElement[], index: number): void {
  items.forEach((item, itemIndex) => {
    item.tabIndex = itemIndex === index ? 0 : -1;
  });
  items[index]?.focus({ preventScroll: true });
}
