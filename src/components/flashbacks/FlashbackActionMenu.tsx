import { Show, createSignal } from "solid-js";

import type { SupportedLanguageCode } from "../../settings/languages";
import {
  captureAsyncActionFocusIntent,
  type AsyncActionFocusOwnership,
} from "../async-action-focus";
import { TrashIcon } from "../icons";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import {
  readFlashbackFailure,
  shouldRevalidateBackupFailsafeAfterFlashbackFailure,
} from "../reader/flashback-failure";
import {
  readFlashbackBackupWarning,
  type FlashbackBackupWarning,
} from "../reader/flashback-backup-warning";
import {
  KebabActionMenu,
  kebabActionMenuDangerItemClass,
  kebabActionMenuErrorClass,
} from "../ui/KebabActionMenu";

export interface FlashbackActionMenuItem {
  endOffset: number;
  id: string;
  langCode?: SupportedLanguageCode | null;
  memoryId: string;
  memoryTitle?: string;
  prefix: string;
  startOffset: number;
  suffix: string;
  text: string;
  translationOutputHash?: string | null;
  variantKind?: "source" | "translation";
}

export interface FlashbackActionMenuProps {
  disabled?: boolean;
  flashback: FlashbackActionMenuItem;
  initialOpen?: boolean;
  onDelete?: (
    flashback: FlashbackActionMenuItem,
    focusOwnership: AsyncActionFocusOwnership,
  ) => Promise<void> | void;
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

  const deleteFlashback = async (
    focusOwnership: AsyncActionFocusOwnership,
  ): Promise<boolean> => {
    setError("");
    try {
      if (props.onDelete !== undefined) {
        await props.onDelete(props.flashback, focusOwnership);
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
              const ownsCurrentFocus = captureAsyncActionFocusIntent(
                event.currentTarget,
              );
              const focusOwnership = {
                actionOwnsFocus: ownsCurrentFocus(),
                ownsCurrentFocus,
              } satisfies AsyncActionFocusOwnership;
              void deleteFlashback(focusOwnership).then((deleted) => {
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
            <p class={kebabActionMenuErrorClass} role="alert">
              {error()}
            </p>
          </Show>
        </>
      )}
    </KebabActionMenu>
  );
}

export async function deleteFlashbackBySelection(
  input: DeleteFlashbackBySelectionInput,
): Promise<FlashbackBackupWarning | undefined> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/flashbacks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      memoryId: input.flashback.memoryId,
      ...(input.flashback.langCode === undefined ||
      input.flashback.langCode === null
        ? {}
        : { langCode: input.flashback.langCode }),
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

  const backupWarning = await readSuccessBackupWarning(response);
  if (backupWarning !== undefined) {
    void revalidateBackupFailsafeAlert();
  }
  return backupWarning;
}

async function readSuccessBackupWarning(
  response: Response,
): Promise<FlashbackBackupWarning | undefined> {
  try {
    return readFlashbackBackupWarning(await response.json());
  } catch {
    return undefined;
  }
}
