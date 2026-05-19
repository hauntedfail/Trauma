import { Show, createSignal } from "solid-js";

import { TrashIcon } from "../icons";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import {
  readFlashbackFailure,
  shouldRevalidateBackupFailsafeAfterFlashbackFailure,
} from "../reader/flashback-failure";
import {
  KebabActionMenu,
  kebabActionMenuDangerItemClass,
  kebabActionMenuErrorClass,
} from "../ui/KebabActionMenu";

export interface FlashbackActionMenuItem {
  endOffset: number;
  id: string;
  memoryId: string;
  memoryTitle?: string;
  prefix: string;
  startOffset: number;
  suffix: string;
  text: string;
}

export interface FlashbackActionMenuProps {
  disabled?: boolean;
  flashback: FlashbackActionMenuItem;
  initialOpen?: boolean;
  onDelete?: (flashback: FlashbackActionMenuItem) => Promise<void> | void;
}

export interface DeleteFlashbackBySelectionInput {
  fetch?: FetchFunction;
  flashback: FlashbackActionMenuItem;
}

type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function FlashbackActionMenu(props: FlashbackActionMenuProps) {
  const [error, setError] = createSignal("");
  const actionLabel = () =>
    props.flashback.memoryTitle === undefined
      ? `Flashback actions for ${props.flashback.text}`
      : `Flashback actions for ${props.flashback.memoryTitle}`;

  const deleteFlashback = async (): Promise<boolean> => {
    setError("");
    try {
      if (props.onDelete !== undefined) {
        await props.onDelete(props.flashback);
      } else {
        await deleteFlashbackBySelection({ flashback: props.flashback });
      }
      return true;
    } catch {
      setError("Failed to delete flashback.");
      return false;
    }
  };

  return (
    <KebabActionMenu
      disabled={props.disabled}
      id={`flashback-${props.flashback.id}-actions-menu`}
      initialOpen={props.initialOpen}
      label={actionLabel()}
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
              void deleteFlashback().then((deleted) => {
                if (deleted) {
                  close();
                }
              });
            }}
          >
            <TrashIcon />
            Delete flashback
          </button>
          <Show when={error() !== ""}>
            <p class={kebabActionMenuErrorClass}>{error()}</p>
          </Show>
        </>
      )}
    </KebabActionMenu>
  );
}

export async function deleteFlashbackBySelection(
  input: DeleteFlashbackBySelectionInput,
): Promise<void> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/flashbacks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      memoryId: input.flashback.memoryId,
      operation: "unflashback",
      selection: {
        text: input.flashback.text,
        prefix: input.flashback.prefix,
        suffix: input.flashback.suffix,
        startOffset: input.flashback.startOffset,
        endOffset: input.flashback.endOffset,
      },
    }),
  });

  const failure = await readFlashbackFailure(response);
  if (failure !== undefined) {
    if (shouldRevalidateBackupFailsafeAfterFlashbackFailure(failure)) {
      void revalidateBackupFailsafeAlert();
    }

    throw new Error(failure.message);
  }
}
