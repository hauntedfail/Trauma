import { Show } from "solid-js";

export function FlashbackInlineText(props: {
  class?: string;
  prefix: string;
  suffix?: string;
  text: string;
}) {
  return (
    <span class={`wrap-anywhere text-sm leading-relaxed ${props.class ?? ""}`}>
      <FlashbackContextText side="before" text={props.prefix} />
      <FlashbackMarkText text={props.text} />
      <FlashbackContextText side="after" text={props.suffix ?? ""} />
    </span>
  );
}

export function FlashbackContextText(props: {
  side: "after" | "before";
  text: string;
}) {
  return (
    <Show when={props.text.length > 0}>
      <span
        class={`trauma-flashback-context trauma-flashback-context-${props.side}`}
      >
        {props.text}
      </span>
    </Show>
  );
}

export function FlashbackMarkText(props: { text: string }) {
  return (
    <mark class="rounded-md bg-transparent px-1 py-px font-bold text-trauma-text-primary">
      {props.text}
    </mark>
  );
}
