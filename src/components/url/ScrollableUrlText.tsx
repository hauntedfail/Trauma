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
  focusable?: boolean;
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
    <span class={`trauma-scroll-url-link ${props.class ?? ""}`}>
      <OpenIcon />
      <ScrollableUrlSurface>
        <a
          class="trauma-scroll-url-text text-inherit"
          href={props.href}
          rel={props.rel}
          target={props.target}
          onClick={props.onClick}
        >
          {props.url}
        </a>
      </ScrollableUrlSurface>
    </span>
  );
}

export function ScrollableUrlDisplay(props: ScrollableUrlTextProps) {
  return (
    <span class={`trauma-scroll-url-link ${props.class ?? ""}`}>
      <OpenIcon />
      <ScrollableUrlText focusable url={props.url} />
    </span>
  );
}

export function ScrollableUrlText(props: ScrollableUrlTextProps) {
  return (
    <ScrollableUrlSurface class={props.class} focusable={props.focusable}>
      <span class="trauma-scroll-url-text">{props.url}</span>
    </ScrollableUrlSurface>
  );
}

function ScrollableUrlSurface(props: {
  children: JSX.Element;
  class?: string;
  focusable?: boolean;
}) {
  let scrollRef: HTMLSpanElement | undefined;
  const [canScrollRight, setCanScrollRight] = createSignal(false);
  const [isScrollable, setIsScrollable] = createSignal(false);
  const updateScrollState = () => {
    if (scrollRef === undefined) {
      setCanScrollRight(false);
      setIsScrollable(false);
      return;
    }

    setIsScrollable(scrollRef.scrollWidth > scrollRef.clientWidth + 1);
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
        tabIndex={props.focusable && isScrollable() ? 0 : undefined}
        onScroll={updateScrollState}
      >
        {props.children}
      </span>
      <Show when={canScrollRight()}>
        <span class="trauma-scroll-url-fade" aria-hidden="true" />
      </Show>
    </span>
  );
}
