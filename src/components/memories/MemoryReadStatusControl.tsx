import { Show, createEffect, createSignal, on } from "solid-js";

import { CheckIcon, EyeClosedIcon, EyeOpenIcon } from "../icons/TraumaIcons";

export interface MemoryReadStatusControlProps {
  memoryId: string;
  initialRead: boolean;
  compact?: boolean;
  variant?: "label" | "icon";
  class?: string;
  onChange?: (read: boolean) => void;
  onSaved?: (read: boolean) => Promise<void> | void;
}

export interface SubmitMemoryReadStatusInput {
  memoryId: string;
  read: boolean;
  fetch?: FetchFunction;
}

export interface SubmitMemoryReadStatusResult {
  memoryId: string;
  read: boolean;
}

type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const buttonClass =
  "inline-grid min-h-9 grid-cols-[auto_auto] items-center gap-2 rounded-full border border-trauma-border-strong px-3 py-1.5 text-xs font-bold text-trauma-text-primary disabled:opacity-60";
const iconButtonClass =
  "grid size-9 place-items-center rounded-full text-trauma-text-muted transition-colors hover:bg-trauma-bg-elev hover:text-trauma-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-trauma-accent disabled:opacity-50";
const statusIconClass = "grid size-4 place-items-center";
const statusDotClass = "size-2 rounded-full bg-current";

export function MemoryReadStatusControl(props: MemoryReadStatusControlProps) {
  const [read, setRead] = createSignal(props.initialRead);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  let requestVersion = 0;

  createEffect(
    on(
      () => [props.memoryId, props.initialRead] as const,
      ([, nextRead]) => {
        requestVersion += 1;
        setRead(nextRead);
        setPending(false);
        setError("");
      },
    ),
  );

  const toggle = async (): Promise<void> => {
    const memoryId = props.memoryId;
    const version = requestVersion + 1;
    requestVersion = version;
    const previous = read();
    const next = !previous;
    setPending(true);
    setError("");
    setRead(next);
    props.onChange?.(next);

    try {
      const result = await submitMemoryReadStatus({
        memoryId,
        read: next,
      });
      if (!isCurrentReadStatusRequest({ memoryId, version })) {
        return;
      }
      void Promise.resolve(props.onSaved?.(result.read)).catch(() => undefined);
    } catch {
      if (!isCurrentReadStatusRequest({ memoryId, version })) {
        return;
      }
      setRead(previous);
      props.onChange?.(previous);
      setError("Failed to update read status.");
    } finally {
      if (isCurrentReadStatusRequest({ memoryId, version })) {
        setPending(false);
      }
    }
  };

  const isCurrentReadStatusRequest = (input: {
    memoryId: string;
    version: number;
  }): boolean =>
    requestVersion === input.version && props.memoryId === input.memoryId;
  const actionHint = () => read() ? "Mark as unread" : "Mark as read";
  const handleToggleClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    void toggle();
  };

  return (
    <span class={`inline-grid gap-1 ${props.class ?? ""}`}>
      <button
        class={props.variant === "icon" ? iconButtonClass : buttonClass}
        type="button"
        aria-pressed={read()}
        aria-label={read() ? "Mark memory unread" : "Mark memory read"}
        title={actionHint()}
        disabled={pending()}
        onClick={handleToggleClick}
      >
        <span
          aria-hidden="true"
          class={props.variant === "icon" ? "grid size-5 place-items-center" : statusIconClass}
          data-read-status-icon={read() ? "read" : "unread"}
        >
          {props.variant === "icon"
            ? read()
              ? <EyeClosedIcon size={18} />
              : <EyeOpenIcon size={18} />
            : read()
              ? <CheckIcon size={16} />
              : <span class={statusDotClass} />}
        </span>
        <ShowVisibleReadStatusLabels compact={props.compact} read={read()} variant={props.variant ?? "label"} />
      </button>
      {error() !== "" ? (
        <span class="text-xs font-bold text-trauma-danger">{error()}</span>
      ) : null}
    </span>
  );
}

function ShowVisibleReadStatusLabels(props: {
  compact?: boolean;
  read: boolean;
  variant: "label" | "icon";
}) {
  return (
    <Show when={props.variant === "label"}>
      <>
        <span>{props.read ? "Read" : "Unread"}</span>
        <span class={props.compact ? "sr-only" : "text-trauma-text-muted"}>
          {props.read ? "Mark unread" : "Mark read"}
        </span>
      </>
    </Show>
  );
}

export async function submitMemoryReadStatus(
  input: SubmitMemoryReadStatusInput,
): Promise<SubmitMemoryReadStatusResult> {
  const requestFetch = input.fetch ?? fetch;
  const response = await requestFetch("/api/memories/read-status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      memoryId: input.memoryId,
      read: input.read,
    }),
  });
  if (!response.ok) {
    throw new Error("failed to update read status");
  }

  return response.json() as Promise<SubmitMemoryReadStatusResult>;
}
