import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

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
const noScrollState = {
  canScrollDown: false,
  canScrollUp: false,
};

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
        <FlashbackShortcutScrollRegion class={props.class ?? "grid gap-3"}>
          <For each={props.flashbacks}>
            {(flashback) => <FlashbackShortcutRow flashback={flashback} />}
          </For>
        </FlashbackShortcutScrollRegion>
      </Show>
    </Show>
  );
}

function FlashbackShortcutScrollRegion(props: {
  children: JSX.Element;
  class: string;
}) {
  let scrollRef: HTMLDivElement | undefined;
  const [scrollState, setScrollState] = createSignal(noScrollState);
  const updateScrollState = () => {
    if (scrollRef === undefined) {
      setScrollState(noScrollState);
      return;
    }

    const hasOverflow = scrollRef.scrollHeight > scrollRef.clientHeight + 1;
    const canScrollUp = hasOverflow && scrollRef.scrollTop > 1;
    const canScrollDown =
      hasOverflow &&
      scrollRef.scrollTop + scrollRef.clientHeight < scrollRef.scrollHeight - 1;
    setScrollState({ canScrollDown, canScrollUp });
  };

  createEffect(() => {
    props.children;
    queueMicrotask(updateScrollState);
  });

  onMount(() => {
    updateScrollState();
    window.addEventListener("resize", updateScrollState);
    onCleanup(() => window.removeEventListener("resize", updateScrollState));
  });

  return (
    <div class="relative overflow-hidden">
      <div ref={scrollRef} class={props.class} onScroll={updateScrollState}>
        {props.children}
      </div>
      <Show when={scrollState().canScrollUp}>
        <div class="trauma-toc-scroll-fade trauma-toc-scroll-fade-top" aria-hidden="true" />
      </Show>
      <Show when={scrollState().canScrollDown}>
        <div class="trauma-toc-scroll-fade trauma-toc-scroll-fade-bottom" aria-hidden="true" />
      </Show>
    </div>
  );
}

function FlashbackShortcutRow(props: { flashback: FlashbackShortcutItem }) {
  const content = () => (
    <span class="wrap-anywhere text-sm leading-relaxed">
      <span class="text-trauma-text-muted">{props.flashback.prefix}</span>
      <mark class="rounded-md bg-transparent px-1 py-px font-bold text-trauma-text-primary">
        {props.flashback.text}
      </mark>
      <span class="text-trauma-text-muted">{props.flashback.suffix ?? ""}</span>
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
