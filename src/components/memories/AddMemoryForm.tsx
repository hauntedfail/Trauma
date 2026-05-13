import { useNavigate } from "@solidjs/router";
import { Show, createMemo, createSignal, type JSX } from "solid-js";

import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import {
  submitAddMemoryUrl,
  type AddMemorySubmitResult,
} from "./add-memory-submit";
import { revalidateBrowseMemories } from "./browse-loader";

export interface AddMemoryFormProps {
  formClass: string;
  inputClass: string;
  buttonClass: string;
  submitLabel: string;
  title?: string;
  showVisibleLabel?: boolean;
  onCreated?: (memoryId: string) => void;
}

export function AddMemoryForm(props: AddMemoryFormProps) {
  const navigate = useNavigate();
  const [url, setUrl] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const canSubmit = createMemo(() => url().trim() !== "" && !isSubmitting());

  const handleSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    void saveMemory();
  };

  async function saveMemory() {
    if (!canSubmit()) {
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const result = await submitAddMemoryUrl({ url: url() });
      if (!result.ok) {
        setErrorMessage(result.error);
        if (shouldRevalidateBackupFailsafeAlert(result)) {
          void revalidateBackupFailsafeAlert();
        }
        return;
      }

      setUrl("");
      void revalidateBrowseMemories();
      navigate(`/memories/${encodeURIComponent(result.memoryId)}`);
      props.onCreated?.(result.memoryId);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      class={props.formClass}
      aria-label="Add memory"
      aria-busy={isSubmitting()}
      onSubmit={handleSubmit}
    >
      <Show when={props.title}>
        {(title) => <h2 class="mb-0 text-[22px] font-bold">{title()}</h2>}
      </Show>
      <label class="grid gap-2">
        <span
          class={
            props.showVisibleLabel === false
              ? "sr-only"
              : "text-[13px] font-extrabold text-[#4e5a48]"
          }
        >
          URL
        </span>
        <input
          class={props.inputClass}
          type="url"
          placeholder="https://example.com/article"
          value={url()}
          required
          disabled={isSubmitting()}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
      </label>
      <button class={props.buttonClass} type="submit" disabled={!canSubmit()}>
        {isSubmitting() ? "Saving..." : props.submitLabel}
      </button>
      <Show when={errorMessage()}>
        {(message) => (
          <p class="col-span-full mb-0 text-sm font-bold text-red-700" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}

export function shouldRevalidateBackupFailsafeAlert(
  result: AddMemorySubmitResult,
) {
  return !result.ok && result.backupFailsafe === true;
}
