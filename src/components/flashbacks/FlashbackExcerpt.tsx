import { Show, type JSX } from "solid-js";

import { FlashbackContextText, FlashbackMarkText } from "./FlashbackText";

interface FlashbackExcerptProps {
  class?: string;
  href?: string;
  prefix: string;
  suffix: string;
  text: string;
}

const quoteClass =
  "m-0 rounded-2xl border-l-4 border-trauma-quote-bar bg-trauma-quote-bg px-4 py-3 leading-relaxed text-trauma-text-primary";

export function FlashbackExcerpt(props: FlashbackExcerptProps) {
  const content = (
    <blockquote class={`${quoteClass} ${props.class ?? ""}`}>
      <FlashbackContextText side="before" text={props.prefix} />
      <FlashbackMarkText text={props.text} />
      <FlashbackContextText side="after" text={props.suffix} />
    </blockquote>
  ) satisfies JSX.Element;

  return (
    <Show when={props.href} fallback={content}>
      {(href) => (
        <a class="block no-underline" href={href()}>
          {content}
        </a>
      )}
    </Show>
  );
}
