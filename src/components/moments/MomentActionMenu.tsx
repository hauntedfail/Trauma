import { Show, createSignal } from "solid-js";

import {
  KebabActionMenu,
  kebabActionMenuDangerItemClass,
  kebabActionMenuErrorClass,
} from "../ui/KebabActionMenu";
import { ConfirmationPopup } from "../ui/ConfirmationPopup";
import { TrashIcon } from "../icons";

export interface MomentActionMenuProps {
  disabled?: boolean;
  initialOpen?: boolean;
  momentId: string;
  onDelete?: (momentId: string) => Promise<void> | void;
  sectionTitle: string;
}

export function MomentActionMenu(props: MomentActionMenuProps) {
  const [error, setError] = createSignal("");

  const deleteMoment = async (): Promise<boolean> => {
    setError("");
    try {
      await props.onDelete?.(props.momentId);
      return true;
    } catch {
      setError("Failed to delete moment.");
      return false;
    }
  };

  return (
    <KebabActionMenu
      disabled={props.disabled}
      id={`moment-${props.momentId}-actions-menu`}
      initialOpen={props.initialOpen}
      label={`Moment actions for ${props.sectionTitle}`}
    >
      {({ close }) => (
        <>
          <ConfirmationPopup
            class="w-full"
            confirmLabel="Delete moment"
            description={`Delete moment "${props.sectionTitle}"? This action cannot be undone.`}
            disabled={props.disabled}
            id={`moment-${props.momentId}-delete-confirmation`}
            label={`Delete moment ${props.sectionTitle} confirmation`}
            onConfirm={async () => {
              const deleted = await deleteMoment();
              if (deleted) {
                close();
              }
              return deleted;
            }}
            trigger={({ triggerProps }) => (
              <button
                {...triggerProps}
                class={`${kebabActionMenuDangerItemClass} w-full`}
                role="menuitem"
                type="button"
              >
                <TrashIcon />
                Delete moment
              </button>
            )}
          />
          <Show when={error() !== ""}>
            <p class={kebabActionMenuErrorClass} role="alert">
              {error()}
            </p>
          </Show>
        </>
      )}
    </KebabActionMenu>
  );
}
