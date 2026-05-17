import { createEffect, createSignal, on } from "solid-js";

import { CheckIcon } from "../icons/TraumaIcons";

export interface MemoryReadStatusControlProps {
  memoryId: string;
  initialRead: boolean;
  compact?: boolean;
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
const statusIconClass = "grid size-4 place-items-center";
const statusDotClass = "size-2 rounded-full bg-current";

export function MemoryReadStatusControl(props: MemoryReadStatusControlProps) {
  const [read, setRead] = createSignal(props.initialRead);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");

  createEffect(
    on(
      () => [props.memoryId, props.initialRead] as const,
      ([, nextRead]) => {
        setRead(nextRead);
        setPending(false);
        setError("");
      },
    ),
  );

  const toggle = async (): Promise<void> => {
    const previous = read();
    const next = !previous;
    setPending(true);
    setError("");
    setRead(next);
    props.onChange?.(next);

    try {
      const result = await submitMemoryReadStatus({
        memoryId: props.memoryId,
        read: next,
      });
      void Promise.resolve(props.onSaved?.(result.read)).catch(() => undefined);
    } catch {
      setRead(previous);
      props.onChange?.(previous);
      setError("Failed to update read status.");
    } finally {
      setPending(false);
    }
  };

  return (
    <span class={`inline-grid gap-1 ${props.class ?? ""}`}>
      <button
        class={buttonClass}
        type="button"
        aria-pressed={read()}
        disabled={pending()}
        onClick={() => void toggle()}
      >
        <span
          aria-hidden="true"
          class={statusIconClass}
          data-read-status-icon={read() ? "read" : "unread"}
        >
          {read() ? <CheckIcon size={16} /> : <span class={statusDotClass} />}
        </span>
        <span>{read() ? "Read" : "Unread"}</span>
        <span class={props.compact ? "sr-only" : "text-trauma-text-muted"}>
          {read() ? "Mark unread" : "Mark read"}
        </span>
      </button>
      {error() !== "" ? (
        <span class="text-xs font-bold text-trauma-danger">{error()}</span>
      ) : null}
    </span>
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
