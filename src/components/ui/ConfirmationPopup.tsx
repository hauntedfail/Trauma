import { createSignal, type JSX } from "solid-js";

import {
  captureAsyncActionFocusIntent,
  type AsyncActionFocusOwnership,
} from "../async-action-focus";
import { Popup, type PopupTriggerControls } from "./Popup";

export interface ConfirmationPopupProps {
  cancelLabel?: string;
  class?: string;
  confirmLabel: string;
  description: string;
  disabled?: boolean;
  id: string;
  initialOpen?: boolean;
  label: string;
  onConfirm: (
    focusOwnership: AsyncActionFocusOwnership,
  ) => boolean | void | Promise<boolean | void>;
  onConfirmError?: (error: unknown) => void;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  trigger: (controls: PopupTriggerControls) => JSX.Element;
}

const panelClass =
  "grid w-[min(320px,calc(100vw-2rem))] gap-4 p-4 text-left text-sm text-trauma-text-primary";
const actionsClass = "flex flex-wrap justify-end gap-2";
const cancelButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-trauma-border-strong px-4 py-2 font-extrabold text-trauma-text-primary disabled:opacity-60";
const confirmButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-trauma-danger px-4 py-2 font-extrabold text-trauma-danger disabled:opacity-60";

export function ConfirmationPopup(props: ConfirmationPopupProps) {
  let confirmButtonRef: HTMLButtonElement | undefined;
  let pendingFocusRef: HTMLDivElement | undefined;
  let revokeActiveFocusOwnership: (() => void) | undefined;
  let confirmationAttempt = 0;
  const [pending, setPending] = createSignal(false);
  const [popupOpen, setPopupOpen] = createSignal(props.initialOpen ?? false);
  const descriptionId = () => `${props.id}-description`;
  const resetConfirmation = (): void => {
    revokeActiveFocusOwnership?.();
    revokeActiveFocusOwnership = undefined;
    confirmationAttempt += 1;
    setPending(false);
  };
  const confirm = async (close: () => void): Promise<void> => {
    if (pending()) {
      return;
    }

    const attempt = ++confirmationAttempt;
    const confirmButton = confirmButtonRef;
    const shouldRestoreFocus = confirmButton === undefined
      ? () => false
      : captureAsyncActionFocusIntent(confirmButton);
    const actionOwnsFocus = shouldRestoreFocus();
    let focusOwnershipRevoked = false;
    revokeActiveFocusOwnership?.();
    const focusOwnership = {
      actionOwnsFocus,
      ownsCurrentFocus: () => {
        if (!actionOwnsFocus || focusOwnershipRevoked) {
          return false;
        }
        const activeElement = typeof document === "undefined"
          ? null
          : document.activeElement;
        const ownsFocus = activeElement === pendingFocusRef ||
          shouldRestoreFocus();
        if (!ownsFocus) {
          focusOwnershipRevoked = true;
        }
        return ownsFocus;
      },
    } satisfies AsyncActionFocusOwnership;
    revokeActiveFocusOwnership = () => {
      focusOwnershipRevoked = true;
    };
    setPending(true);
    if (
      focusOwnership.actionOwnsFocus &&
      pendingFocusRef?.isConnected === true
    ) {
      pendingFocusRef.focus({ preventScroll: true });
    }
    let shouldRestoreConfirmFocus = false;
    try {
      const result = await props.onConfirm(focusOwnership);
      if (attempt === confirmationAttempt && popupOpen()) {
        if (result === false) {
          shouldRestoreConfirmFocus = true;
        } else {
          // A successful action may still need the token after this popup is
          // removed (for example, to focus the next revalidated row).
          revokeActiveFocusOwnership = undefined;
          close();
        }
      }
    } catch (error) {
      if (attempt === confirmationAttempt) {
        shouldRestoreConfirmFocus = true;
        props.onConfirmError?.(error);
      }
    } finally {
      if (attempt === confirmationAttempt && popupOpen()) {
        setPending(false);
        if (shouldRestoreConfirmFocus) {
          restoreFailedConfirmationFocus({
            confirmButton,
            focusOwnership,
            isCurrent: () =>
              attempt === confirmationAttempt && popupOpen(),
          });
        }
      }
    }
  };

  return (
    <Popup
      class={props.class}
      descriptionId={descriptionId()}
      disabled={props.disabled}
      id={props.id}
      initialOpen={props.initialOpen}
      label={props.label}
      mode="dialog"
      panelClass={panelClass}
      placement={props.placement ?? "bottom-end"}
      onClose={resetConfirmation}
      onOpenChange={setPopupOpen}
      trigger={props.trigger}
    >
      {({ close }) => (
        <div
          ref={pendingFocusRef}
          aria-busy={pending()}
          class="grid gap-4"
          tabIndex={-1}
        >
          <p class="mb-0 font-semibold" id={descriptionId()}>
            {props.description}
          </p>
          <div class={actionsClass}>
            <button
              class={cancelButtonClass}
              disabled={pending()}
              type="button"
              onClick={close}
            >
              {props.cancelLabel ?? "Cancel"}
            </button>
            <button
              ref={confirmButtonRef}
              class={confirmButtonClass}
              disabled={pending()}
              type="button"
              onClick={() => void confirm(close)}
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </Popup>
  );
}

export function restoreFailedConfirmationFocus(input: {
  confirmButton: HTMLButtonElement | undefined;
  focusOwnership: AsyncActionFocusOwnership;
  isCurrent: () => boolean;
}): void {
  queueMicrotask(() => {
    const confirmButton = input.confirmButton;
    if (
      !input.isCurrent() ||
      confirmButton?.isConnected !== true ||
      confirmButton.disabled ||
      !input.focusOwnership.ownsCurrentFocus()
    ) {
      return;
    }
    confirmButton.focus({ preventScroll: true });
  });
}
