import { Popover } from "@kobalte/core/popover";
import {
  Show,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";

import {
  useDismissableLayer,
  type DismissableLayerDismissReason,
} from "./dismissable-layer";

interface RegisteredChildPopup {
  containsNode: (target: EventTarget | null) => boolean;
  isOpen: () => boolean;
}

interface PopupParentContextValue {
  onChildDismissedOutside: (target: EventTarget | null) => void;
  registerChild: (child: RegisteredChildPopup) => () => void;
}

const PopupParentContext = createContext<PopupParentContextValue | undefined>(
  undefined,
);

export interface PopupControls {
  close: () => void;
  open: boolean;
}

export interface PopupTriggerControls extends PopupControls {
  toggle: () => void;
  triggerProps: JSX.ButtonHTMLAttributes<HTMLButtonElement>;
}

export type PopupPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "right-start"
  | "right-end"
  | "left-start"
  | "left-end";

export interface PopupProps {
  children: (controls: PopupControls) => JSX.Element;
  class?: string;
  descriptionId?: string;
  disabled?: boolean;
  id: string;
  initialOpen?: boolean;
  label: string;
  mode?: "dialog" | "menu";
  panelClass?: string;
  phonePanel?: boolean;
  placement?: PopupPlacement;
  trigger: (controls: PopupTriggerControls) => JSX.Element;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}

const rootClass = "relative inline-grid";

// Coss / Linear-inspired surface: crisp 1px border, layered elevation shadow,
// subtle inner highlight ring, and smooth enter/exit transitions.
const panelBaseClass =
  "trauma-ui-popover z-[70] rounded-2xl border border-trauma-border/90 bg-trauma-bg-elev/95 text-trauma-text-primary shadow-[0_14px_38px_-10px_rgb(0_0_0/0.34),0_2px_8px_-2px_rgb(0_0_0/0.16)] backdrop-blur-xl ring-1 ring-inset ring-white/[0.06] outline-none";

const phonePanelClass =
  "fixed inset-x-3 bottom-[calc(4.75rem+var(--trauma-layout-safe-area-bottom))] mx-auto w-[min(360px,calc(100vw-1.5rem))]";

export function Popup(props: PopupProps) {
  let rootRef: HTMLDivElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  let activeTrigger: HTMLButtonElement | undefined;
  let activeTriggerIndex = 0;
  let hasObservedOpenState = false;
  const parentPopup = useContext(PopupParentContext);
  const childPopups = new Set<RegisteredChildPopup>();
  const [open, setOpen] = createSignal(props.initialOpen ?? false);
  const mode = () => props.mode ?? "dialog";
  const placement = (): PopupPlacement => props.placement ?? "bottom-start";

  const hasOpenChildPopup = (): boolean => {
    for (const child of childPopups) {
      if (child.isOpen()) {
        return true;
      }
    }
    return false;
  };

  const containsNode = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) {
      return false;
    }
    if (rootRef !== undefined && rootRef.contains(target)) {
      return true;
    }
    if (panelRef?.isConnected === true && panelRef.contains(target)) {
      return true;
    }
    for (const child of childPopups) {
      if (child.isOpen() && child.containsNode(target)) {
        return true;
      }
    }
    return false;
  };

  if (parentPopup !== undefined) {
    const unregister = parentPopup.registerChild({
      containsNode,
      isOpen: open,
    });
    onCleanup(unregister);
  }

  const closePopup = (restoreFocus: boolean): void => {
    if (restoreFocus) {
      focusConnectedPopupTrigger(activeTrigger, rootRef, activeTriggerIndex);
      restorePopupTriggerFocus(activeTrigger, rootRef, activeTriggerIndex);
    }
    setOpen(false);
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

  const parentContextValue: PopupParentContextValue = {
    registerChild: (child) => {
      childPopups.add(child);
      return () => {
        childPopups.delete(child);
      };
    },
    onChildDismissedOutside: (target) => {
      if (
        mode() === "menu" &&
        open() &&
        !hasOpenChildPopup() &&
        !containsNode(target)
      ) {
        closePopup(false);
        parentPopup?.onChildDismissedOutside(target);
      }
    },
  };

  createEffect(() => {
    const nextOpen = open();
    if (!nextOpen) {
      panelRef = undefined;
    }
    untrack(() => props.onOpenChange?.(nextOpen));
    if (hasObservedOpenState && !nextOpen) {
      untrack(() => props.onClose?.());
    }
    hasObservedOpenState = true;
  });

  useDismissableLayer({
    getRoot: () => rootRef,
    isEnabled: open,
    shouldIgnoreOutsidePointerDown: (target) => containsNode(target),
    onDismiss: (
      reason: DismissableLayerDismissReason,
      target?: EventTarget | null,
    ) => {
      closePopup(reason === "escape");
      if (reason === "outside-pointer") {
        parentPopup?.onChildDismissedOutside(target ?? null);
      }
    },
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
      activeTriggerIndex =
        rootRef === undefined
          ? 0
          : [
              ...rootRef.querySelectorAll<HTMLButtonElement>(
                "button[aria-haspopup]",
              ),
            ].indexOf(activeTrigger);
      toggle();
    },
  });

  return (
    <Popover
      open={open()}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setOpen(false);
        } else if (props.disabled !== true) {
          setOpen(true);
        }
      }}
      placement={placement()}
      gutter={8}
      flip={true}
      shift={8}
      overlap={false}
      modal={false}
    >
      <Popover.Anchor
        as="div"
        ref={rootRef}
        class={`${rootClass} ${props.class ?? ""}`}
      >
        {props.trigger({
          close,
          open: open(),
          toggle,
          triggerProps: triggerProps(),
        })}
      </Popover.Anchor>

      <Show when={open()}>
        <Show
          when={!isServer}
          fallback={
            <Popover.Content
              aria-describedby={props.descriptionId}
              aria-label={props.label}
              class={`${panelBaseClass} ${
                props.phonePanel === true ? phonePanelClass : ""
              } ${props.panelClass ?? ""}`}
              id={props.id}
              role={mode()}
              tabIndex={-1}
            >
              {props.children({ close, open: open() })}
            </Popover.Content>
          }
        >
          <Popover.Portal>
            <Popover.Content
              ref={(panel: HTMLDivElement) => {
                panelRef = panel;
                focusPopupPanel(panel, mode());
              }}
              aria-describedby={props.descriptionId}
              aria-label={props.label}
              class={`${panelBaseClass} ${
                props.phonePanel === true ? phonePanelClass : ""
              } ${props.panelClass ?? ""}`}
              id={props.id}
              role={mode()}
              tabIndex={-1}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
              }}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
              }}
              onPointerDownOutside={(event) => {
                event.preventDefault();
              }}
              onFocusOutside={(event) => {
                event.preventDefault();
              }}
              onInteractOutside={(event) => {
                event.preventDefault();
              }}
              onFocusOut={(event: FocusEvent & { currentTarget: HTMLDivElement }) => {
                const panel = event.currentTarget;
                if (
                  mode() === "menu" &&
                  (!(event.relatedTarget instanceof Node) ||
                    panel.contains(event.relatedTarget) !== true)
                ) {
                  queueMicrotask(() => {
                    if (!open() || hasOpenChildPopup()) {
                      return;
                    }
                    const active = document.activeElement;
                    if (!panel.contains(active)) {
                      closePopup(false);
                    }
                  });
                }
              }}
              onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
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
              <PopupParentContext.Provider value={parentContextValue}>
                {props.children({ close, open: open() })}
              </PopupParentContext.Provider>
            </Popover.Content>
          </Popover.Portal>
        </Show>
      </Show>
    </Popover>
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

function focusPopupPanel(panel: HTMLDivElement, mode: "dialog" | "menu"): void {
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
    focusConnectedPopupTrigger(trigger, root, triggerIndex);
  });
}

function focusConnectedPopupTrigger(
  trigger: HTMLButtonElement | undefined,
  root: HTMLDivElement | undefined,
  triggerIndex: number,
): boolean {
  const target =
    trigger?.isConnected === true
      ? trigger
      : root?.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]")[
          Math.max(triggerIndex, 0)
        ];
  if (target?.isConnected !== true || target.disabled) {
    return false;
  }

  target.focus({ preventScroll: true });
  return true;
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
