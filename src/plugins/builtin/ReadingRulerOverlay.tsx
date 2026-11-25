import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { useFocusPlugins } from "../context";
import { READING_RULER_PLUGIN_ID } from "./definitions";

export type ReadingRulerStyle = "lightbox" | "grey-bar" | "shade" | "underline";
export type ReadingRulerFollowMode = "cursor" | "scroll-center" | "keyboard";

export interface ReadingRulerGeometry {
  readonly topPx: number;
  readonly bandHeightPx: number;
  readonly bottomStartPx: number;
}

const LINE_HEIGHT_PX = 30;
const KEYBOARD_STEP_PX = 36;

export function computeReadingRulerGeometry(input: {
  viewportHeight: number;
  anchorY: number;
  windowLines: number;
}): ReadingRulerGeometry {
  const safeViewport = Math.max(120, Math.round(input.viewportHeight));
  const clampedLines = Math.min(5, Math.max(1, Math.round(input.windowLines)));
  const bandHeightPx = Math.min(safeViewport, clampedLines * LINE_HEIGHT_PX);
  const maxTop = Math.max(0, safeViewport - bandHeightPx);
  const centeredTop = Math.round(input.anchorY - bandHeightPx / 2);
  const topPx = Math.min(maxTop, Math.max(0, centeredTop));
  return {
    topPx,
    bandHeightPx,
    bottomStartPx: topPx + bandHeightPx,
  };
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function ReadingRulerOverlay() {
  const focusPlugins = useFocusPlugins();
  const isEnabled = createMemo(() =>
    focusPlugins.isPluginEnabled(READING_RULER_PLUGIN_ID),
  );
  const style = createMemo<ReadingRulerStyle>(() => {
    const raw = focusPlugins.getPluginSetting<string>(
      READING_RULER_PLUGIN_ID,
      "style",
    );
    if (
      raw === "lightbox" ||
      raw === "grey-bar" ||
      raw === "shade" ||
      raw === "underline"
    ) {
      return raw;
    }
    return "lightbox";
  });
  const windowLines = createMemo<number>(() => {
    const raw = focusPlugins.getPluginSetting<number>(
      READING_RULER_PLUGIN_ID,
      "windowLines",
    );
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 2;
  });
  const opacityFraction = createMemo<number>(() => {
    const raw = focusPlugins.getPluginSetting<number>(
      READING_RULER_PLUGIN_ID,
      "opacity",
    );
    const pct = typeof raw === "number" && Number.isFinite(raw) ? raw : 35;
    return Math.min(0.85, Math.max(0.1, pct / 100));
  });
  const followMode = createMemo<ReadingRulerFollowMode>(() => {
    const raw = focusPlugins.getPluginSetting<string>(
      READING_RULER_PLUGIN_ID,
      "followMode",
    );
    if (raw === "cursor" || raw === "scroll-center" || raw === "keyboard") {
      return raw;
    }
    return "cursor";
  });
  const keyboardEnabled = createMemo<boolean>(() => {
    const raw = focusPlugins.getPluginSetting<boolean>(
      READING_RULER_PLUGIN_ID,
      "keyboardNavigation",
    );
    return raw !== false;
  });

  const [viewportHeight, setViewportHeight] = createSignal(800);
  const [anchorY, setAnchorY] = createSignal(320);

  const geometry = createMemo(() =>
    computeReadingRulerGeometry({
      viewportHeight: viewportHeight(),
      anchorY:
        followMode() === "scroll-center"
          ? Math.round(viewportHeight() * 0.42)
          : anchorY(),
      windowLines: windowLines(),
    }),
  );

  createEffect(() => {
    if (!isEnabled() || typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      const nextHeight = window.innerHeight || 800;
      setViewportHeight(nextHeight);
      setAnchorY((prev) => Math.min(nextHeight, Math.max(0, prev)));
    };
    syncViewport();

    const handlePointerMove = (event: PointerEvent) => {
      if (followMode() === "cursor") {
        setAnchorY(event.clientY);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!keyboardEnabled() || isEditableEventTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === "j") {
        setAnchorY((prev) =>
          Math.min(viewportHeight() - 24, prev + KEYBOARD_STEP_PX),
        );
      } else if (event.key === "k") {
        setAnchorY((prev) => Math.max(24, prev - KEYBOARD_STEP_PX));
      }
    };

    window.addEventListener("resize", syncViewport);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <Show when={isEnabled()}>
      <div
        aria-hidden="true"
        class="pointer-events-none fixed inset-0 z-40"
        data-focus-plugin="reading-ruler"
        data-reading-ruler-style={style()}
      >
        <Show when={style() === "lightbox"}>
          <div
            class="trauma-reading-ruler-band fixed inset-x-0 top-0 transition-[height] duration-75"
            style={{
              height: `${geometry().topPx}px`,
              "background-color": `rgba(15, 23, 42, ${opacityFraction()})`,
            }}
          />
          <div
            class="trauma-reading-ruler-band fixed inset-x-0 border-y border-trauma-accent/35 transition-[top,height] duration-75"
            style={{
              top: `${geometry().topPx}px`,
              height: `${geometry().bandHeightPx}px`,
            }}
          />
          <div
            class="trauma-reading-ruler-band fixed inset-x-0 bottom-0 transition-[top] duration-75"
            style={{
              top: `${geometry().bottomStartPx}px`,
              "background-color": `rgba(15, 23, 42, ${opacityFraction()})`,
            }}
          />
        </Show>

        <Show when={style() === "grey-bar"}>
          <div
            class="trauma-reading-ruler-band fixed inset-x-0 border-y border-trauma-accent/30 transition-[top,height] duration-75"
            style={{
              top: `${geometry().topPx}px`,
              height: `${geometry().bandHeightPx}px`,
              "background-color": `rgba(100, 116, 139, ${Math.min(0.45, opacityFraction() * 0.55)})`,
            }}
          />
        </Show>

        <Show when={style() === "shade"}>
          <div
            class="trauma-reading-ruler-band fixed inset-x-0 bottom-0 border-t-2 border-trauma-accent/60 transition-[top] duration-75"
            style={{
              top: `${geometry().bottomStartPx}px`,
              "background-color": `rgba(15, 23, 42, ${opacityFraction()})`,
            }}
          />
        </Show>

        <Show when={style() === "underline"}>
          <div
            class="trauma-reading-ruler-band fixed inset-x-0 transition-[top] duration-75"
            style={{
              top: `${geometry().bottomStartPx}px`,
              height: "3px",
              "background-color": `rgba(14, 165, 233, ${Math.min(0.95, opacityFraction() + 0.35)})`,
              "box-shadow": "0 1px 6px rgba(14, 165, 233, 0.28)",
            }}
          />
        </Show>
      </div>
    </Show>
  );
}
