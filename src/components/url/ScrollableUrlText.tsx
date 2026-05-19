import {
  Show,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import { OpenIcon } from "../icons";

export interface ScrollableUrlTextProps {
  class?: string;
  url: string;
}

export interface ScrollableUrlLinkProps extends ScrollableUrlTextProps {
  href: string;
  onClick?: JSX.EventHandler<HTMLAnchorElement, MouseEvent>;
  rel?: string;
  target?: string;
}

export function ScrollableUrlLink(props: ScrollableUrlLinkProps) {
  return (
    <a
      class={`trauma-scroll-url-link ${props.class ?? ""}`}
      href={props.href}
      rel={props.rel}
      target={props.target}
      onClick={props.onClick}
    >
      <OpenIcon />
      <ScrollableUrlText url={props.url} />
    </a>
  );
}

export function ScrollableUrlDisplay(props: ScrollableUrlTextProps) {
  return (
    <span class={`trauma-scroll-url-link ${props.class ?? ""}`}>
      <OpenIcon />
      <ScrollableUrlText url={props.url} />
    </span>
  );
}

export function ScrollableUrlText(props: ScrollableUrlTextProps) {
  let scrollRef: HTMLSpanElement | undefined;
  const [canScrollRight, setCanScrollRight] = createSignal(false);
  const updateScrollState = () => {
    if (scrollRef === undefined) {
      setCanScrollRight(false);
      return;
    }

    setCanScrollRight(
      scrollRef.scrollLeft + scrollRef.clientWidth < scrollRef.scrollWidth - 1,
    );
  };

  onMount(() => {
    updateScrollState();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateScrollState);
    if (scrollRef !== undefined) {
      resizeObserver?.observe(scrollRef);
    }
    window.addEventListener("resize", updateScrollState);
    onCleanup(() => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollState);
    });
  });

  return (
    <span class={`trauma-scroll-url-shell ${props.class ?? ""}`}>
      <span
        ref={scrollRef}
        class="trauma-scroll-url-body"
        data-can-scroll-right={canScrollRight() ? "true" : undefined}
        onScroll={updateScrollState}
      >
        <span class="trauma-scroll-url-text">{props.url}</span>
      </span>
      <Show when={canScrollRight()}>
        <span class="trauma-scroll-url-fade" aria-hidden="true" />
      </Show>
    </span>
  );
}
