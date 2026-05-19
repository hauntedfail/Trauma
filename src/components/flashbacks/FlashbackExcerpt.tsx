import { Show, type JSX } from "solid-js";

import { FlashbackInlineText } from "./FlashbackText";

interface FlashbackExcerptProps {
  class?: string;
  href?: string;
  prefix: string;
  suffix: string;
  text: string;
}

const excerptClass = "m-0 rounded-2xl px-3 py-2 text-trauma-text-primary";

export function FlashbackExcerpt(props: FlashbackExcerptProps) {
  const content = (
    <p class={`${excerptClass} ${props.class ?? ""}`}>
      <FlashbackInlineText
        prefix={props.prefix}
        suffix={props.suffix}
        text={props.text}
      />
    </p>
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
