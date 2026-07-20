import { createEffect, onCleanup } from "solid-js";

const activeLayerIds: symbol[] = [];
const OUTSIDE_CLICK_SUPPRESSION_TIMEOUT_MS = 1_200;

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
  let outsideClickSuppressionPointerId: number | undefined;
  let outsideClickSuppressionTimeout: number | undefined;
  const isEnabled = () => options.isEnabled?.() ?? true;
  const isTopmostLayer = () => activeLayerIds.at(-1) === layerId;
  const isOutside = (target: EventTarget | null): boolean => {
    const root = options.getRoot();
    return root !== undefined && target instanceof Node && !root.contains(target);
  };
  const handleSuppressedOutsideClick = (event: MouseEvent) => {
    const pointerId = readEventPointerId(event);
    const shouldSuppress = pointerId === undefined ||
      pointerId === outsideClickSuppressionPointerId;
    clearOutsideClickSuppression();
    if (!shouldSuppress) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const handleSuppressedPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === outsideClickSuppressionPointerId) {
      clearOutsideClickSuppression();
    }
  };
  const handleSuppressedPointerUp = (event: PointerEvent) => {
    if (event.pointerId === outsideClickSuppressionPointerId) {
      scheduleOutsideClickSuppressionClear(0);
    }
  };
  const handleInterruptedPointerDown = () => {
    clearOutsideClickSuppression();
  };
  const clearOutsideClickSuppression = () => {
    outsideClickSuppressionPointerId = undefined;
    if (outsideClickSuppressionTimeout !== undefined) {
      window.clearTimeout(outsideClickSuppressionTimeout);
      outsideClickSuppressionTimeout = undefined;
    }
    document.removeEventListener("click", handleSuppressedOutsideClick, true);
    document.removeEventListener(
      "pointercancel",
      handleSuppressedPointerCancel,
      true,
    );
    document.removeEventListener("pointerup", handleSuppressedPointerUp, true);
    document.removeEventListener(
      "pointerdown",
      handleInterruptedPointerDown,
      true,
    );
    document.removeEventListener("keydown", clearOutsideClickSuppression, true);
    window.removeEventListener("blur", clearOutsideClickSuppression);
  };
  const scheduleOutsideClickSuppressionClear = (delayMs: number) => {
    if (outsideClickSuppressionTimeout !== undefined) {
      window.clearTimeout(outsideClickSuppressionTimeout);
    }
    outsideClickSuppressionTimeout = window.setTimeout(
      clearOutsideClickSuppression,
      delayMs,
    );
  };
  const armOutsideClickSuppression = (event: PointerEvent) => {
    if (outsideClickSuppressionPointerId !== undefined) {
      return;
    }

    outsideClickSuppressionPointerId = event.pointerId;
    document.addEventListener("click", handleSuppressedOutsideClick, {
      capture: true,
      once: true,
    });
    document.addEventListener(
      "pointercancel",
      handleSuppressedPointerCancel,
      true,
    );
    document.addEventListener("pointerup", handleSuppressedPointerUp, true);
    document.addEventListener(
      "pointerdown",
      handleInterruptedPointerDown,
      true,
    );
    document.addEventListener("keydown", clearOutsideClickSuppression, true);
    window.addEventListener("blur", clearOutsideClickSuppression);
    scheduleOutsideClickSuppressionClear(
      OUTSIDE_CLICK_SUPPRESSION_TIMEOUT_MS,
    );
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
        armOutsideClickSuppression(event);
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

function readEventPointerId(event: MouseEvent): number | undefined {
  const pointerId = Reflect.get(event, "pointerId");
  return typeof pointerId === "number" ? pointerId : undefined;
}
