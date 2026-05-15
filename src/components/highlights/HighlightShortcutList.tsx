import { For, Show } from "solid-js";

export interface HighlightShortcutItem {
  active?: boolean;
  href?: string;
  id: string;
  onSelect?: () => void;
  prefix: string;
  text: string;
}

const highlightShortcutRowClass =
  "grid w-full gap-1 rounded-2xl px-3 py-2 text-left text-trauma-text-primary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-accent aria-pressed:text-trauma-accent-ink";

export function HighlightShortcutList(props: {
  class?: string;
  emptyLabel: string;
  highlights: HighlightShortcutItem[];
  isLoading?: boolean;
}) {
  return (
    <Show
      when={props.isLoading !== true}
      fallback={<p class="mb-0 text-sm font-bold text-trauma-text-muted">Loading highlights...</p>}
    >
      <Show
        when={props.highlights.length > 0}
        fallback={<p class="mb-0 text-sm font-bold text-trauma-text-muted">{props.emptyLabel}</p>}
      >
        <div class={props.class ?? "grid gap-3"}>
          <For each={props.highlights}>
            {(highlight) => <HighlightShortcutRow highlight={highlight} />}
          </For>
        </div>
      </Show>
    </Show>
  );
}

function HighlightShortcutRow(props: { highlight: HighlightShortcutItem }) {
  const content = () => (
    <>
      <span class="wrap-anywhere">{props.highlight.text}</span>
      <small class="text-xs font-semibold text-trauma-text-muted">
        {props.highlight.prefix}
      </small>
    </>
  );

  return (
    <Show
      when={props.highlight.href}
      fallback={
        <button
          aria-pressed={props.highlight.active === true}
          class={highlightShortcutRowClass}
          type="button"
          onClick={props.highlight.onSelect}
        >
          {content()}
        </button>
      }
    >
      {(href) => (
        <a class={`${highlightShortcutRowClass} no-underline`} href={href()}>
          {content()}
        </a>
      )}
    </Show>
  );
}
