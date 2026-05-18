import { createEffect, onCleanup } from "solid-js";

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
  let outsideClickSuppressionArmed = false;
  const isEnabled = () => options.isEnabled?.() ?? true;
  const isOutside = (target: EventTarget | null): boolean => {
    const root = options.getRoot();
    return root !== undefined && target instanceof Node && !root.contains(target);
  };
  const handleSuppressedOutsideClick = (event: MouseEvent) => {
    outsideClickSuppressionArmed = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const armOutsideClickSuppression = () => {
    if (outsideClickSuppressionArmed) {
      return;
    }

    outsideClickSuppressionArmed = true;
    document.addEventListener("click", handleSuppressedOutsideClick, {
      capture: true,
      once: true,
    });
  };

  createEffect(() => {
    if (!isEnabled()) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!isOutside(event.target)) {
        return;
      }
      if (options.shouldIgnoreOutsidePointerDown?.(event.target) === true) {
        return;
      }

      if (options.shouldSuppressOutsideClick?.(event.target) ?? true) {
        armOutsideClickSuppression();
      }
      options.onDismiss();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        options.onDismiss();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });
}
