import { Show, type JSX } from "solid-js";

interface FlashbackExcerptProps {
  class?: string;
  href?: string;
  prefix: string;
  suffix: string;
  text: string;
}

const quoteClass =
  "m-0 grid gap-1 rounded-2xl border-l-4 border-trauma-quote-bar bg-trauma-quote-bg px-4 py-3 leading-relaxed text-trauma-quote-ink";
const markClass =
  "w-fit rounded-md bg-trauma-flashback-bg px-1.5 py-px text-trauma-flashback-ink";

export function FlashbackExcerpt(props: FlashbackExcerptProps) {
  const content = (
    <blockquote class={`${quoteClass} ${props.class ?? ""}`}>
      <Show when={props.prefix.length > 0}>
        <span>{props.prefix}</span>
      </Show>
      <mark class={markClass}>{props.text}</mark>
      <Show when={props.suffix.length > 0}>
        <span>{props.suffix}</span>
      </Show>
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
