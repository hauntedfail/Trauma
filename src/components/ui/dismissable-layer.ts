import { onCleanup, onMount } from "solid-js";

export interface DismissableLayerOptions<TRoot extends HTMLElement> {
  getRoot: () => TRoot | undefined;
  isEnabled?: () => boolean;
  onDismiss: () => void;
  shouldIgnoreOutsidePointerDown?: (target: EventTarget | null) => boolean;
  shouldSuppressOutsideClick?: (target: EventTarget | null) => boolean;
}

export function useDismissableLayer<TRoot extends HTMLElement>(
  options: DismissableLayerOptions<TRoot>,
): void {
  let suppressNextOutsideClick = false;
  const isEnabled = () => options.isEnabled?.() ?? true;
  const isOutside = (target: EventTarget | null): boolean => {
    const root = options.getRoot();
    return root !== undefined && target instanceof Node && !root.contains(target);
  };

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!isEnabled() || !isOutside(event.target)) {
        return;
      }
      if (options.shouldIgnoreOutsidePointerDown?.(event.target) === true) {
        return;
      }

      suppressNextOutsideClick = true;
      options.onDismiss();
    };
    const handleClick = (event: MouseEvent) => {
      if (!suppressNextOutsideClick) {
        return;
      }

      suppressNextOutsideClick = false;
      if (
        !isOutside(event.target) ||
        options.shouldSuppressOutsideClick?.(event.target) !== true
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEnabled() && event.key === "Escape") {
        options.onDismiss();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });
}
