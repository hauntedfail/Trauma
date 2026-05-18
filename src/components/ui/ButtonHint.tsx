import { createSignal, onCleanup, onMount } from "solid-js";

export interface ButtonHintProps {
  children: string;
}

export function ButtonHint(props: ButtonHintProps) {
  let tooltipElement: HTMLSpanElement | undefined;
  const [isVisible, setIsVisible] = createSignal(false);

  onMount(() => {
    const triggerElement = tooltipElement?.parentElement;
    if (!triggerElement) {
      return;
    }

    const showHint = () => setIsVisible(true);
    const hideHint = () => setIsVisible(false);

    triggerElement.addEventListener("mouseenter", showHint);
    triggerElement.addEventListener("focusin", showHint);
    triggerElement.addEventListener("mouseleave", hideHint);
    triggerElement.addEventListener("focusout", hideHint);

    onCleanup(() => {
      triggerElement.removeEventListener("mouseenter", showHint);
      triggerElement.removeEventListener("focusin", showHint);
      triggerElement.removeEventListener("mouseleave", hideHint);
      triggerElement.removeEventListener("focusout", hideHint);
    });
  });

  return (
    <span
      ref={tooltipElement}
      aria-hidden={isVisible() ? undefined : "true"}
      class="trauma-button-hint"
      role="tooltip"
    >
      {isVisible() ? props.children : null}
    </span>
  );
}
