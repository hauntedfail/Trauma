import { useNavigate } from "@solidjs/router";
import { Show, onCleanup, type JSX } from "solid-js";

import type { AddMemorySubmissionController } from "./add-memory-controller";
import { WaxSealButton, WaxSealLabel } from "../ui/WaxSealButton";

export interface AddMemoryFormProps {
  formClass: string;
  inputClass: string;
  buttonClass: string;
  submitLabel: string;
  submission: AddMemorySubmissionController;
  title?: string;
  showVisibleLabel?: boolean;
  onCreated?: (memoryId: string) => void;
}

export function AddMemoryForm(props: AddMemoryFormProps) {
  const navigate = useNavigate();
  const view = props.submission.createView();
  onCleanup(view.dispose);

  const handleSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    void saveMemory();
  };

  async function saveMemory() {
    if (!props.submission.canSubmit()) {
      return;
    }

    await view.submit({
      onCreated: (memoryId) => {
        navigate(`/memories/${encodeURIComponent(memoryId)}`);
        props.onCreated?.(memoryId);
      },
    });
  }

  return (
    <form
      class={props.formClass}
      aria-label="Add memory"
      aria-busy={props.submission.isSubmitting()}
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
              : "text-[13px] font-extrabold text-trauma-text-muted"
          }
        >
          URL
        </span>
        <input
          class={props.inputClass}
          type="url"
          placeholder="https://example.com/article"
          value={props.submission.url()}
          required
          disabled={props.submission.isSubmitting()}
          onInput={(event) => props.submission.setUrl(event.currentTarget.value)}
        />
      </label>
      <WaxSealButton
        class={props.buttonClass}
        disabled={!props.submission.canSubmit()}
        hint={props.submission.isSubmitting() ? "Saving..." : props.submitLabel}
        type="submit"
        variant="command"
      >
        <WaxSealLabel>
          {props.submission.isSubmitting() ? "Saving..." : props.submitLabel}
        </WaxSealLabel>
      </WaxSealButton>
      <Show when={props.submission.errorMessage()}>
        {(message) => (
          <p class="col-span-full mb-0 text-sm font-bold text-red-700" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </form>
  );
}
