import { Show } from "solid-js";

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
