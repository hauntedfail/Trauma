import { createSignal, type JSX } from "solid-js";

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
  onConfirm: () => boolean | void | Promise<boolean | void>;
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
  let confirmationAttempt = 0;
  const [pending, setPending] = createSignal(false);
  const [popupOpen, setPopupOpen] = createSignal(props.initialOpen ?? false);
  const descriptionId = () => `${props.id}-description`;
  const resetConfirmation = (): void => {
    confirmationAttempt += 1;
    setPending(false);
  };
  const confirm = async (close: () => void): Promise<void> => {
    if (pending()) {
      return;
    }

    const attempt = ++confirmationAttempt;
    setPending(true);
    try {
      const result = await props.onConfirm();
      if (
        attempt === confirmationAttempt &&
        result !== false &&
        popupOpen()
      ) {
        close();
      }
    } catch (error) {
      if (attempt === confirmationAttempt) {
        props.onConfirmError?.(error);
      }
    } finally {
      if (attempt === confirmationAttempt && popupOpen()) {
        setPending(false);
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
        <div aria-busy={pending()} class="grid gap-4">
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
