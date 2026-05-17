import type { JSX } from "solid-js";

export const segmentedToggleButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-bold text-trauma-text-secondary transition hover:bg-trauma-bg-tint aria-pressed:bg-trauma-bg-elev aria-pressed:text-trauma-text-primary aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-trauma-border-strong";

export function SegmentedToggleButton(props: {
  active: boolean;
  children: JSX.Element;
  class?: string;
  onClick: () => void;
}) {
  const buttonClass = () =>
    props.class === undefined
      ? segmentedToggleButtonClass
      : `${segmentedToggleButtonClass} ${props.class}`;

  return (
    <button
      aria-pressed={props.active}
      class={buttonClass()}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
