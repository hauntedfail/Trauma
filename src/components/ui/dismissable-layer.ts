import { createEffect, onCleanup } from "solid-js";

const activeLayerIds: symbol[] = [];

export type DismissableLayerDismissReason = "escape" | "outside-pointer";

export interface DismissableLayerOptions<TRoot extends HTMLElement> {
  getRoot: () => TRoot | undefined;
  isEnabled?: () => boolean;
  onDismiss: (reason: DismissableLayerDismissReason) => void;
  shouldIgnoreOutsidePointerDown?: (target: EventTarget | null) => boolean;
  shouldSuppressOutsideClick?: (target: EventTarget | null) => boolean;
}

export function useDismissableLayer<TRoot extends HTMLElement>(
  options: DismissableLayerOptions<TRoot>,
): void {
  const layerId = Symbol("dismissable-layer");
  let outsideClickSuppressionArmed = false;
  const isEnabled = () => options.isEnabled?.() ?? true;
  const isTopmostLayer = () => activeLayerIds.at(-1) === layerId;
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

    activeLayerIds.push(layerId);
    const handlePointerDown = (event: PointerEvent) => {
      if (!isTopmostLayer()) {
        return;
      }
      if (!isOutside(event.target)) {
        return;
      }
      if (options.shouldIgnoreOutsidePointerDown?.(event.target) === true) {
        return;
      }

      if (
        isClickProducingPrimaryPointerDown(event) &&
        (options.shouldSuppressOutsideClick?.(event.target) ?? true)
      ) {
        armOutsideClickSuppression();
      }
      options.onDismiss("outside-pointer");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopmostLayer()) {
        event.preventDefault();
        options.onDismiss("escape");
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      const layerIndex = activeLayerIds.lastIndexOf(layerId);
      if (layerIndex !== -1) {
        activeLayerIds.splice(layerIndex, 1);
      }
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });
}

function isClickProducingPrimaryPointerDown(event: PointerEvent): boolean {
  return event.button === 0 && event.isPrimary !== false;
}
