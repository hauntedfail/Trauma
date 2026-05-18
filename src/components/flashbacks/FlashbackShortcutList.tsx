import {
  For,
  Show,
} from "solid-js";

import { FlashbackContextText, FlashbackMarkText } from "./FlashbackText";

export interface FlashbackShortcutItem {
  active?: boolean;
  href?: string;
  id: string;
  onSelect?: () => void;
  prefix: string;
  suffix?: string;
  text: string;
}

const flashbackShortcutRowClass =
  "grid w-full gap-1 rounded-2xl px-3 py-2 text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink";

export function FlashbackShortcutList(props: {
  class?: string;
  emptyLabel: string;
  flashbacks: FlashbackShortcutItem[];
  isLoading?: boolean;
}) {
  return (
    <Show
      when={props.isLoading !== true}
      fallback={<p class="mb-0 text-sm font-bold text-trauma-text-muted">Loading flashbacks...</p>}
    >
      <Show
        when={props.flashbacks.length > 0}
        fallback={<p class="mb-0 text-sm font-bold text-trauma-text-muted">{props.emptyLabel}</p>}
      >
        <div class={props.class ?? "grid gap-3"}>
          <For each={props.flashbacks}>
            {(flashback) => <FlashbackShortcutRow flashback={flashback} />}
          </For>
        </div>
      </Show>
    </Show>
  );
}

function FlashbackShortcutRow(props: { flashback: FlashbackShortcutItem }) {
  const content = () => (
    <span class="wrap-anywhere text-sm leading-relaxed">
      <FlashbackContextText side="before" text={props.flashback.prefix} />
      <FlashbackMarkText text={props.flashback.text} />
      <FlashbackContextText side="after" text={props.flashback.suffix ?? ""} />
    </span>
  );

  return (
    <Show
      when={props.flashback.href}
      fallback={
        <button
          aria-pressed={props.flashback.active === true}
          class={flashbackShortcutRowClass}
          type="button"
          onClick={props.flashback.onSelect}
        >
          {content()}
        </button>
      }
    >
      {(href) => (
        <a class={`${flashbackShortcutRowClass} no-underline`} href={href()}>
          {content()}
        </a>
      )}
    </Show>
  );
}
