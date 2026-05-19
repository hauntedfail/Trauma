import { Show, createSignal } from "solid-js";

import {
  KebabActionMenu,
  kebabActionMenuDangerItemClass,
  kebabActionMenuErrorClass,
} from "../ui/KebabActionMenu";
import { TrashIcon } from "../icons";

export interface MomentActionMenuProps {
  disabled?: boolean;
  initialOpen?: boolean;
  momentId: string;
  onDelete?: (momentId: string) => Promise<void> | void;
  sectionTitle: string;
}

export interface ConfirmAndDeleteMomentInput {
  confirm: (message: string) => boolean;
  momentId: string;
  onDelete?: (momentId: string) => Promise<void> | void;
  sectionTitle: string;
}

export function MomentActionMenu(props: MomentActionMenuProps) {
  const [error, setError] = createSignal("");

  const deleteMoment = async (): Promise<boolean> => {
    setError("");
    try {
      return await confirmAndDeleteMoment({
        momentId: props.momentId,
        sectionTitle: props.sectionTitle,
        confirm: (message) =>
          typeof window === "undefined" ? false : window.confirm(message),
        onDelete: props.onDelete,
      });
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
          <button
            class={kebabActionMenuDangerItemClass}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void deleteMoment().then((deleted) => {
                if (deleted) {
                  close();
                }
              });
            }}
          >
            <TrashIcon />
            Delete moment
          </button>
          <Show when={error() !== ""}>
            <p class={kebabActionMenuErrorClass}>{error()}</p>
          </Show>
        </>
      )}
    </KebabActionMenu>
  );
}

export async function confirmAndDeleteMoment(
  input: ConfirmAndDeleteMomentInput,
): Promise<boolean> {
  if (!input.confirm(`Delete moment "${input.sectionTitle}"?`)) {
    return false;
  }

  await input.onDelete?.(input.momentId);
  return true;
}
